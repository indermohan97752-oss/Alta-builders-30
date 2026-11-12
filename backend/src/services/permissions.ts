export type Role = "owner" | "admin" | "member";

const rank: Record<Role, number> = { owner: 3, admin: 2, member: 1 };

export const isAdmin = (role: Role) => rank[role] >= rank.admin;

export const canEditRoom = isAdmin;
export const canAddMembers = isAdmin;
export const canDeleteRoom = (role: Role) => role === "owner";

/** Admins can remove members; the owner can remove anyone else. Nobody removes an equal or higher role. */
export const canRemoveMember = (actor: Role, target: Role) => isAdmin(actor) && rank[actor] > rank[target];

/** Only the owner changes roles, and only between admin and member. */
export const canChangeRole = (actor: Role, target: Role, newRole: Role) =>
  actor === "owner" && target !== "owner" && newRole !== "owner";
