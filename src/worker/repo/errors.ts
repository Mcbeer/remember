// Thrown when a write targets a resource the User is not permitted to write to
// (e.g. creating a List in a Family they have no Membership in). Distinct from
// the not-found signal used for reads, which deliberately hides existence.
export class AuthorizationError extends Error {
  constructor(message = "Not authorized") {
    super(message);
    this.name = "AuthorizationError";
  }
}
