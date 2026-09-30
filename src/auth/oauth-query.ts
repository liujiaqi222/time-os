import { constantTimeEqual, makeSignature } from "better-auth/crypto";

export async function verifySignedOAuthQuery(
  query: string,
  secret: string,
  now = new Date(),
): Promise<boolean> {
  const params = new URLSearchParams(query);
  const signatures = params.getAll("sig");
  const signature = signatures[0];
  const expiresAt = Number(params.get("exp"));
  params.delete("sig");

  if (
    signatures.length !== 1 ||
    !signature ||
    !Number.isFinite(expiresAt) ||
    expiresAt * 1000 < now.getTime()
  ) {
    return false;
  }

  const canonical = new URLSearchParams(
    [...params.entries()].sort(([keyA, valueA], [keyB, valueB]) => {
      if (keyA < keyB) return -1;
      if (keyA > keyB) return 1;
      if (valueA < valueB) return -1;
      if (valueA > valueB) return 1;
      return 0;
    }),
  );
  const expected = await makeSignature(canonical.toString(), secret);
  return constantTimeEqual(signature, expected);
}
