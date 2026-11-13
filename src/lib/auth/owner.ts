export function getPrivateOwnerSubject(): string | null {
  return process.env.PRIVATE_PLUGIN_SUBJECT?.trim() || null;
}

export function resolveWebOwnerSubject(subject: string | null): string | null {
  const owner = getPrivateOwnerSubject();
  return owner && subject === owner ? owner : null;
}
