import express from 'express';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();

app.use(morgan('dev'));
app.use(express.json());

// Define __dirname in ES module scope
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Serve the React frontend
app.use(express.static(path.join(__dirname, 'keymaster-app/build')));

app.use((req, res, next) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, 'keymaster-app/build', 'index.html'));
    } else {
        console.warn(`Warning: Unhandled API endpoint - ${req.method} ${req.originalUrl}`);
        res.status(404).json({ message: 'Endpoint not found' });
    }
});

const port = 7007;

app.listen(port, () => {
    console.log(`keymaster server running on port ${port}`);
});
