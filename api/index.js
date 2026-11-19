// Vercel Function: every /api/* request is rewritten here (see vercel.json) and handled by
// the Express app. server/dist is built by the build command before functions are bundled.
import app from '../server/dist/vercel.js';

export default app;
