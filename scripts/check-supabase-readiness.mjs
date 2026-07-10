#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";

const DEFAULT_SUPABASE_URL = "https://ndkgjxkkqwffddrkjbxv.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "sb_publishable_qihsQCXeQUSOZdVMha8B4w_U8cE52vB";
const BUCKET = "dumpdeck-photos";

const supabaseUrl =
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
const anonKey =
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  DEFAULT_SUPABASE_ANON_KEY;
const email = process.env.FOTOFAIRY_READINESS_EMAIL;
const password = process.env.FOTOFAIRY_READINESS_PASSWORD;

const checks = [];

function record(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  const icon = ok ? "✓" : "✗";
  console.log(`${icon} ${name}${detail ? ` — ${detail}` : ""}`);
}

function failWithChecklist(message) {
  console.log(`\n${message}`);
  console.log("\nManual production checklist:");
  console.log("- Apply every SQL file in supabase/migrations in timestamp order.");
  console.log("- Confirm public.dumpdeck_drafts exists and RLS is enabled.");
  console.log("- Confirm public.saved_projects exists and RLS is enabled.");
  console.log("- Confirm public.saved_project_photos includes storage path columns.");
  console.log("- Confirm the private Storage bucket dumpdeck-photos exists.");
  console.log("- Confirm Storage policies restrict paths to auth.uid() as the first folder.");
  console.log(
    "- Confirm an authenticated user can upload, sign, read, and delete only their own files.",
  );
  console.log(
    "- Confirm opening a saved collection generates fresh signed URLs without gray tiles.",
  );
}

async function expectQuery(supabase, table, select = "id") {
  const { error } = await supabase.from(table).select(select).limit(1);
  if (error) {
    record(`${table} query`, false, error.message);
    return false;
  }
  record(`${table} query`, true);
  return true;
}

async function main() {
  console.log("FotoFairy Supabase readiness check\n");
  console.log(`Project: ${supabaseUrl}`);
  console.log(`Bucket: ${BUCKET}\n`);

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (!email || !password) {
    failWithChecklist(
      "Set FOTOFAIRY_READINESS_EMAIL and FOTOFAIRY_READINESS_PASSWORD to run authenticated RLS/storage checks.",
    );
    process.exitCode = 0;
    return;
  }

  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || !signInData.user) {
    record("test user sign-in", false, signInError?.message ?? "No user returned");
    process.exitCode = 1;
    return;
  }
  record("test user sign-in", true, signInData.user.id);

  const tableChecks = await Promise.all([
    expectQuery(supabase, "dumpdeck_drafts", "id, project_id, draft_payload"),
    expectQuery(supabase, "saved_projects", "id, title, user_id"),
    expectQuery(
      supabase,
      "saved_project_photos",
      "id, project_id, storage_bucket, original_storage_path, preview_storage_path",
    ),
  ]);

  const objectPath = `${signInData.user.id}/readiness/${Date.now()}.txt`;
  const file = new Blob([`FotoFairy readiness ${new Date().toISOString()}`], {
    type: "text/plain",
  });

  const upload = await supabase.storage.from(BUCKET).upload(objectPath, file, {
    contentType: "text/plain",
    upsert: true,
  });
  record("storage upload to own folder", !upload.error, upload.error?.message ?? objectPath);

  let signedOk = false;
  if (!upload.error) {
    const signed = await supabase.storage.from(BUCKET).createSignedUrl(objectPath, 60);
    signedOk = Boolean(signed.data?.signedUrl) && !signed.error;
    record("signed URL generation", signedOk, signed.error?.message ?? "fresh signed URL created");
  }

  const remove = await supabase.storage.from(BUCKET).remove([objectPath]);
  record("storage cleanup", !remove.error, remove.error?.message ?? objectPath);

  await supabase.auth.signOut();

  const ok = tableChecks.every(Boolean) && !upload.error && signedOk && !remove.error;
  console.log("\nSummary");
  console.table(checks);
  if (!ok) {
    failWithChecklist("One or more readiness checks failed.");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Readiness check crashed:", error);
  process.exitCode = 1;
});
