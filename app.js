// fetch url and get local issuer certificates
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

function createStreamApp() {
    const app = express();

    app.use(cors());

    app.get('/stream', async (req, res) => {
        const songUrl = req.query.url;

        if (!songUrl) {
            return res.status(400).send('Missing URL parameter');
        }

        try {
            const response = await fetch(songUrl);

            if (!response.ok) {
                return res.status(response.status).send(`Error fetching song: ${response.statusText}`);
            }

            const contentLength = response.headers.get("content-length") || "0";

            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader("Content-Length", contentLength);
            res.setHeader('Content-Range', `bytes 0-${Number(contentLength) - 1}/${contentLength}`);
            res.setHeader('Content-Disposition', 'inline');
            res.setHeader('Accept-Ranges', 'bytes');

            // Set content type if available, otherwise let the browser infer
            const contentType = response.headers.get('content-type');
            if (contentType) {
                res.setHeader('Content-Type', contentType);
            }

            response.body.pipe(res);

            response.body.on('error', (err) => {
                console.error('Error piping response:', err);
                if (!res.headersSent) {
                    res.status(500).send('Error streaming song');
                } else {
                    res.end();
                }
            });

        } catch (error) {
            console.error('Error streaming song:', error);
            res.status(500).send('Error streaming song');
        }
    });

    return app;
}

function startServer(port = process.env.PORT || 5501) {
    return new Promise((resolve, reject) => {
        const streamApp = createStreamApp();
        const server = streamApp.listen(port, () => {
            const address = server.address();
            const actualPort = (address && typeof address === 'object') ? address.port : port;
            console.log(`Server listening on port ${actualPort}`);
            console.log(`Usage: http://localhost:${actualPort}/stream?url=<SONG_URL>`);
            resolve(server);
        });

        server.on('error', reject);
    });
}

if (require.main === module) {
    startServer().catch(error => {
        console.error('Failed to start server:', error);
        process.exit(1);
    });
}

module.exports = {
    createStreamApp,
    startServer,
};
