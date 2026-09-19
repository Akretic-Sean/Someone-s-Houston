/** Internal Auth identifier only; this is not a contact email. */
export function usernameEmail(username) {
  const canonical = username.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(canonical)) throw new Error('Invalid username');
  return `${canonical}@users.someones-houston.invalid`;
}
