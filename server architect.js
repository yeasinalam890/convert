const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const PDFDocument = require('pdfkit');
const { pdf } = require('pdf-poppler');

const app = express();
const PORT = 3000;

// Create uploads directory instantly if it doesn't exist
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

const upload = multer({ dest: 'uploads/' });

app.use(express.static('public'));

// Primary Processing Route
app.post('/convert', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).send('No file payload transferred.');

    const inputPath = req.file.path;
    const targetFormat = req.body.outputFormat ? req.body.outputFormat.toLowerCase() : null;
    const shouldCompress = req.body.compress === 'true';
    const qualityValue = parseInt(req.body.quality) || 80;
    const inputExt = path.extname(req.file.originalname).toLowerCase();
    
    // Track files created during execution to delete them later
    let trackingGarbageList = [inputPath];

    try {
        const isInputImage = ['.jpg', '.jpeg', '.png', '.webp', '.tiff'].includes(inputExt);
        const isOutputImage = ['jpg', 'jpeg', 'png', 'webp'].includes(targetFormat);

        // CASE 1: Pure Image Operation (Image to Image OR Image Compression Only)
        if (isInputImage && (isOutputImage || !targetFormat)) {
            const outExt = targetFormat || inputExt.replace('.', '');
            const outputPath = path.join(uploadDir, `img_${Date.now()}.${outExt}`);
            trackingGarbageList.push(outputPath);

            let engine = sharp(inputPath);

            // Conditional compression profiles based on structural types
            if (outExt === 'jpg' || outExt === 'jpeg') {
                engine = engine.jpeg({ quality: shouldCompress ? qualityValue : 95 });
            } else if (outExt === 'webp') {
                engine = engine.webp({ quality: shouldCompress ? qualityValue : 90 });
            } else if (outExt === 'png') {
                // Map 10-100% UI slider value safely to PNG compression levels 0-9
                const pngCompression = shouldCompress ? Math.floor((100 - qualityValue) / 10) : 6;
                engine = engine.png({ compressionLevel: pngCompression });
            }

            await engine.toFile(outputPath);
            return res.download(outputPath, () => cleanup(trackingGarbageList));
        }

        // CASE 2: Image to PDF Document Compilation
        if (isInputImage && targetFormat === 'pdf') {
            const outputPath = path.join(uploadDir, `doc_${Date.now()}.pdf`);
            trackingGarbageList.push(outputPath);

            // Compress the image before passing it to PDFKit
            const optimizedImgTemp = path.join(uploadDir, `temp_${Date.now()}.jpg`);
            trackingGarbageList.push(optimizedImgTemp);
            
            await sharp(inputPath).jpeg({ quality: shouldCompress ? qualityValue : 95 }).toFile(optimizedImgTemp);

            const doc = new PDFDocument({ margin: 0 });
            const writeStream = fs.createWriteStream(outputPath);
            
            doc.pipe(writeStream);
            doc.image(optimizedImgTemp, 0, 0, { width: 600 });
            doc.end();

            return writeStream.on('finish', () => {
                res.download(outputPath, () => cleanup(trackingGarbageList));
            });
        }

        // CASE 3: PDF Document Extracting to Images (Requires Poppler System Binary)
        if (inputExt === '.pdf' && isOutputImage) {
            const outFormatToken = targetFormat === 'jpg' ? 'jpeg' : targetFormat;
            const outputPrefix = `extracted_${Date.now()}`;
            
            const popplerOptions = {
                format: outFormatToken,
                out_dir: uploadDir,
                out_prefix: outputPrefix,
                page: 1 // Extract page 1 for basic template operations
            };

            await pdf.convert(inputPath, popplerOptions);
            
            // Poppler generates names in this exact format (e.g. prefix-1.jpeg)
            const popplerGeneratedName = `${outputPrefix}-1.${targetFormat === 'jpg' ? 'jpg' : targetFormat}`;
            const outputPath = path.join(uploadDir, popplerGeneratedName);
            trackingGarbageList.push(outputPath);

            if (!fs.existsSync(outputPath)) {
                throw new Error("Conversion system failed to map binary paths.");
            }

            return res.download(outputPath, () => cleanup(trackingGarbageList));
        }

        // Fallback: If no processing loops catch the configuration
        cleanup(trackingGarbageList);
        return res.status(400).send('The requested conversion path is not supported.');

    } catch (error) {
        console.error("Pipeline breakdown:", error);
        cleanup(trackingGarbageList);
        return res.status(500).send(`Engine Error: ${error.message}`);
    }
});

// Structural Storage Garbage collection
function cleanup(files) {
    files.forEach(file => {
        try {
            if (fs.existsSync(file)) fs.unlinkSync(file);
        } catch (e) {
            console.error(`Cleanup failed for file: ${file}`, e);
        }
    });
}

app.listen(PORT, () => console.log(`Active Hub Online: http://localhost:${PORT}`));
