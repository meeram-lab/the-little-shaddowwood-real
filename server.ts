import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  const app = express();
  const isProd = process.argv.includes('--prod') || process.env.NODE_ENV === 'production';

  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ limit: '100mb', extended: true }));

  const publicAssetsDir = path.join(__dirname, 'public', 'assets', 'custom');
  const manifestPath = path.join(publicAssetsDir, 'custom-assets-manifest.json');

  // Serve custom assets directly
  app.use('/assets/custom', express.static(publicAssetsDir));

  // Custom Asset Manifest API
  app.get('/api/custom-assets/manifest', async (_req, res) => {
    try {
      const fs = await import('fs/promises');
      const data = await fs.readFile(manifestPath, 'utf-8');
      res.setHeader('Content-Type', 'application/json');
      res.send(data);
    } catch {
      res.json({ version: 1, exportedAt: new Date().toISOString(), assets: {} });
    }
  });

  // Save uploaded custom GLB directly to project public/assets/custom/ directory
  app.post('/api/custom-assets/save', async (req, res) => {
    try {
      const fs = await import('fs/promises');
      const { slot, fileName, base64Data, metadata } = req.body;
      if (!slot || !fileName || !base64Data) {
        res.status(400).json({ error: 'Missing required parameters (slot, fileName, base64Data)' });
        return;
      }

      await fs.mkdir(publicAssetsDir, { recursive: true });
      const buffer = Buffer.from(base64Data, 'base64');
      const targetFilePath = path.join(publicAssetsDir, fileName);
      await fs.writeFile(targetFilePath, buffer);

      // Read or initialize manifest
      let manifest: { version: number; exportedAt: string; assets: Record<string, unknown> } = {
        version: 1,
        exportedAt: new Date().toISOString(),
        assets: {},
      };
      try {
        const raw = await fs.readFile(manifestPath, 'utf-8');
        manifest = JSON.parse(raw);
      } catch {
        // use default
      }

      manifest.assets[slot] = {
        slot,
        fileName,
        url: `/assets/custom/${fileName}`,
        category: metadata?.category || 'CUSTOM',
        scale: metadata?.scale ?? 1.0,
        targetHeightMeters: metadata?.targetHeightMeters,
        rotationY: metadata?.rotationY ?? 0,
        placement: metadata?.placement,
        animationSettings: metadata?.animationSettings,
        fileSizeBytes: buffer.byteLength,
        uploadedAt: new Date().toISOString(),
      };
      manifest.exportedAt = new Date().toISOString();

      const manifestContent = JSON.stringify(manifest, null, 2);
      await fs.writeFile(manifestPath, manifestContent, 'utf-8');

      // Also copy to dist if dist exists
      const distAssetsDir = path.join(__dirname, 'dist', 'assets', 'custom');
      try {
        await fs.mkdir(distAssetsDir, { recursive: true });
        await fs.writeFile(path.join(distAssetsDir, fileName), buffer);
        await fs.writeFile(path.join(distAssetsDir, 'custom-assets-manifest.json'), manifestContent, 'utf-8');
      } catch {
        // dist might not exist yet before build
      }

      res.json({
        success: true,
        slot,
        fileName,
        url: `/assets/custom/${fileName}`,
        bytesSaved: buffer.byteLength,
      });
    } catch (err) {
      console.error('Failed to save custom asset:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Delete custom GLB from project
  app.post('/api/custom-assets/delete', async (req, res) => {
    try {
      const fs = await import('fs/promises');
      const { slot } = req.body;
      if (!slot) {
        res.status(400).json({ error: 'Missing slot' });
        return;
      }

      let manifest: { version: number; exportedAt: string; assets: Record<string, { fileName: string }> } = {
        version: 1,
        exportedAt: new Date().toISOString(),
        assets: {},
      };
      try {
        const raw = await fs.readFile(manifestPath, 'utf-8');
        manifest = JSON.parse(raw);
      } catch {
        // ignore
      }

      const existing = manifest.assets[slot];
      if (existing && existing.fileName) {
        try {
          await fs.unlink(path.join(publicAssetsDir, existing.fileName));
        } catch {
          // ignore
        }
        delete manifest.assets[slot];
        manifest.exportedAt = new Date().toISOString();
        await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
      }

      res.json({ success: true, slot });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`The Little Shadowwood single-player server running at http://localhost:${PORT}`);
  });
}

void startServer();
