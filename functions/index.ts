import { createDatabaseClient, createSiteContext, errorResponse, BackendError } from './_qoder/backend.mjs';
import { createStorageClient } from './_qoder/storage.mjs';
import { application } from './routes.mjs';

const handle = application({ db: createDatabaseClient(), storage: createStorageClient(), BackendError });

Deno.serve(async (request) => {
  let context;
  try {
    // forwardApplicationCredentials keeps the application's own admin session
    // cookie while the platform strips platform cookies and reserved headers.
    context = createSiteContext(request, { forwardApplicationCredentials: true });
    return await handle(context);
  } catch (error) {
    return errorResponse(error, context?.requestId);
  }
});
