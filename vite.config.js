import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({mode}) => ({
  plugins: [{
    name: 'local-api',
    configureServer(server) {
      Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
      server.middlewares.use('/api/gestao', async (req, res) => {
        const {default: handler} = await server.ssrLoadModule('/api/gestao.js');
        await handler(req, res);
      });
    }
  }]
}));
