# Ownership is the only sharing axis

A List is owned by either a single User (personal) or a Family (shared). A List
is visible to exactly its owner — the one User, or every Member of the owning
Family. There is **no** ad-hoc sharing of an individual List with specific Users.

To share something, it must live in a Family. Families are flat: all Memberships
are equal, with no owner/admin role — any Member can create, edit, and delete any
List or Item in the Family and generate Invites.

This was chosen over per-list ACL sharing (rejected: more complex, two sharing
mechanisms) because it keeps the model simple and matches a trusting-household
mental model. Consequence: you cannot share a personal List with one friend
without forming a Family, and any Member can remove data or other Members.

When the last Member leaves a Family, the Family and its Lists and Items are
deleted (no orphaned data). Items belong to their List, not their creator, so a
leaving Member's Items remain while other Members exist.
