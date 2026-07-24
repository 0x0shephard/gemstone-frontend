import { adminClient, requireUser } from '../_shared/auth.ts';
import { json, preflight } from '../_shared/cors.ts';

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  try {
    const user = await requireUser(request);
    const { evidenceFileId } = await request.json();
    const admin = adminClient();
    const { data: file, error } = await admin
      .from('evidence_files')
      .select('bucket,object_path')
      .eq('id', evidenceFileId)
      .eq('owner_id', user.id)
      .single();
    if (error || !file) return json({ error: 'Private file not found' }, 404);
    const { data, error: signedError } = await admin.storage
      .from(file.bucket)
      .createSignedUrl(file.object_path, 300);
    if (signedError) throw signedError;
    return json({ signedUrl: data.signedUrl, expiresIn: 300 });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Signed URL failed' }, 400);
  }
});
