export type ActorRole = "owner" | "manager" | "bookkeeper" | "cashier" | "worker";

export type Permission =
  | "manage_billing"
  | "approve_override"
  | "reconcile_shift"
  | "post_journal"
  | "allocate_payment"
  | "run_statements"
  | "request_account_sale"
  | "perform_cash_count"
  | "process_inbox_outbox"
  | "view_accounts"
  | "manage_accounts"
  | "manage_policy";

const ROLE_PERMISSIONS: Record<ActorRole, ReadonlySet<Permission>> = {
  owner: new Set<Permission>([
    "manage_billing",
    "approve_override",
    "reconcile_shift",
    "post_journal",
    "allocate_payment",
    "run_statements",
    "request_account_sale",
    "perform_cash_count",
    "view_accounts",
    "manage_accounts",
    "manage_policy",
  ]),
  manager: new Set<Permission>([
    "approve_override",
    "reconcile_shift",
    "post_journal",
    "allocate_payment",
    "run_statements",
    "request_account_sale",
    "perform_cash_count",
    "view_accounts",
    "manage_accounts",
    "manage_policy",
  ]),
  bookkeeper: new Set<Permission>([
    "post_journal",
    "allocate_payment",
    "run_statements",
    "view_accounts",
    "manage_accounts",
  ]),
  cashier: new Set<Permission>([
    "request_account_sale",
    "perform_cash_count",
    "view_accounts",
  ]),
  worker: new Set<Permission>([
    "process_inbox_outbox",
  ]),
};

export class AuthorizationError extends Error {
  public readonly role: ActorRole;
  public readonly requiredPermission: Permission;

  constructor(role: ActorRole, requiredPermission: Permission) {
    super(`Role '${role}' is not authorized to perform '${requiredPermission}'`);
    this.role = role;
    this.requiredPermission = requiredPermission;
    this.name = "AuthorizationError";
  }
}

/**
 * Checks whether an actor role has a given permission.
 */
export function hasPermission(role: ActorRole, permission: Permission): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  return permissions ? permissions.has(permission) : false;
}

/**
 * Asserts that an actor role has a given permission; throws AuthorizationError otherwise.
 */
export function assertPermission(role: ActorRole, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new AuthorizationError(role, permission);
  }
}
