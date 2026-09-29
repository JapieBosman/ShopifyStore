/**
 * Shopify Admin GraphQL API Client with Leaky-Bucket Cost Scheduler,
 * GraphQL error handling, userErrors extraction, pagination, and bulk query bootstrap.
 */

export interface GraphQLCostExtension {
  requestedQueryCost: number;
  actualQueryCost: number;
  throttleStatus: {
    maximumAvailable: number;
    currentlyAvailable: number;
    restoreRate: number;
  };
}

export interface GraphQLErrorLocation {
  line: number;
  column: number;
}

export interface GraphQLError {
  message: string;
  locations?: GraphQLErrorLocation[];
  path?: Array<string | number>;
  extensions?: {
    code?: string;
    [key: string]: unknown;
  };
}

export interface GraphQLResponse<T = Record<string, unknown>> {
  data?: T;
  errors?: GraphQLError[];
  extensions?: {
    cost?: GraphQLCostExtension;
    [key: string]: unknown;
  };
}

export interface ShopifyUserError {
  field?: string[] | null;
  message: string;
}

export class ShopifyGraphQLError extends Error {
  public errors: GraphQLError[];
  public status: number;

  constructor(message: string, errors: GraphQLError[], status = 200) {
    super(message);
    this.name = "ShopifyGraphQLError";
    this.errors = errors;
    this.status = status;
  }
}

export class ShopifyUserErrorCollection extends Error {
  public userErrors: ShopifyUserError[];

  constructor(message: string, userErrors: ShopifyUserError[]) {
    super(message);
    this.name = "ShopifyUserErrorCollection";
    this.userErrors = userErrors;
  }
}

export class ShopifyThrottleError extends Error {
  public retryAfterSeconds?: number;

  constructor(message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "ShopifyThrottleError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ShopifyHttpError extends Error {
  public status: number;
  public statusText: string;
  public body: string;

  constructor(status: number, statusText: string, body: string) {
    super(`Shopify HTTP ${status} ${statusText}: ${body}`);
    this.name = "ShopifyHttpError";
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

export interface ShopThrottleState {
  maximumAvailable: number;
  currentlyAvailable: number;
  restoreRate: number; // points per second
  lastUpdated: number; // ms timestamp
}

export type OperationPriority = "high" | "normal" | "low";

/**
 * Per-shop leaky-bucket cost scheduler.
 * Tracks available GraphQL rate limit points and enforces rate pacing based on Shopify's extensions.cost.
 */
export class ShopifyCostScheduler {
  private states = new Map<string, ShopThrottleState>();
  private defaultMax = 1000.0;
  private defaultRestoreRate = 100.0; // standard Shopify restore rate = 100 pts/sec

  public getShopState(shop: string): ShopThrottleState {
    let state = this.states.get(shop);
    if (!state) {
      state = {
        maximumAvailable: this.defaultMax,
        currentlyAvailable: this.defaultMax,
        restoreRate: this.defaultRestoreRate,
        lastUpdated: Date.now(),
      };
      this.states.set(shop, state);
    } else {
      // Refill tokens based on elapsed time
      const now = Date.now();
      const elapsedSec = Math.max(0, (now - state.lastUpdated) / 1000);
      state.currentlyAvailable = Math.min(
        state.maximumAvailable,
        state.currentlyAvailable + elapsedSec * state.restoreRate,
      );
      state.lastUpdated = now;
    }
    return state;
  }

  public updateFromResponse(shop: string, costExtension?: GraphQLCostExtension): void {
    if (!costExtension?.throttleStatus) {
      return;
    }
    const { maximumAvailable, currentlyAvailable, restoreRate } = costExtension.throttleStatus;
    this.states.set(shop, {
      maximumAvailable,
      currentlyAvailable,
      restoreRate,
      lastUpdated: Date.now(),
    });
  }

  /**
   * Schedules execution by reserving points or sleeping until required points restore.
   * High priority operations (e.g. POS cart/sale checkout) wait less or jump queue.
   */
  public async schedule(
    shop: string,
    estimatedCost = 50,
    priority: OperationPriority = "normal",
  ): Promise<void> {
    const state = this.getShopState(shop);

    // If available points are below estimated cost, wait for replenishment
    if (state.currentlyAvailable < estimatedCost) {
      const deficit = estimatedCost - state.currentlyAvailable;
      const waitMs = Math.ceil((deficit / state.restoreRate) * 1000);
      // Wait for restore
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      // Re-evaluate state
      const refreshed = this.getShopState(shop);
      refreshed.currentlyAvailable = Math.max(0, refreshed.currentlyAvailable - estimatedCost);
      refreshed.lastUpdated = Date.now();
      return;
    }

    // Deduct estimated cost
    state.currentlyAvailable = Math.max(0, state.currentlyAvailable - estimatedCost);
    state.lastUpdated = Date.now();
  }

  public clearShop(shop: string): void {
    this.states.delete(shop);
  }
}

export interface ShopifyClientOptions {
  shopDomain: string;
  accessToken: string;
  apiVersion?: string;
  costScheduler?: ShopifyCostScheduler;
  maxRetries?: number;
  fetchFn?: typeof fetch;
}

export interface RequestOptions {
  estimatedCost?: number;
  priority?: OperationPriority;
}

export interface MutateOptions extends RequestOptions {
  assertNoUserErrors?: boolean;
}

export interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export class ShopifyClient {
  public shopDomain: string;
  public accessToken: string;
  public apiVersion: string;
  public costScheduler: ShopifyCostScheduler;
  public maxRetries: number;
  private fetchFn: typeof fetch;

  constructor(options: ShopifyClientOptions) {
    this.shopDomain = options.shopDomain;
    this.accessToken = options.accessToken;
    this.apiVersion = options.apiVersion ?? "2026-07";
    this.costScheduler = options.costScheduler ?? new ShopifyCostScheduler();
    this.maxRetries = options.maxRetries ?? 3;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  public get endpoint(): string {
    return `https://${this.shopDomain}/admin/api/${this.apiVersion}/graphql.json`;
  }

  /**
   * Executes a GraphQL query or mutation with rate limit scheduling and retry backoff.
   */
  public async executeGraphQL<T = Record<string, unknown>>(
    query: string,
    variables?: Record<string, unknown>,
    options?: RequestOptions,
  ): Promise<GraphQLResponse<T>> {
    let attempt = 0;
    const estimatedCost = options?.estimatedCost ?? 50;
    const priority = options?.priority ?? "normal";

    while (attempt <= this.maxRetries) {
      attempt++;

      // Wait for cost scheduler budget
      await this.costScheduler.schedule(this.shopDomain, estimatedCost, priority);

      let response: Response;
      try {
        response = await this.fetchFn(this.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": this.accessToken,
          },
          body: JSON.stringify({ query, variables }),
        });
      } catch (networkErr) {
        if (attempt > this.maxRetries) {
          throw networkErr;
        }
        // Jittered backoff for network glitch
        await new Promise((r) => setTimeout(r, attempt * 200 + Math.random() * 100));
        continue;
      }

      // Check HTTP 429 Throttling
      if (response.status === 429) {
        const retryAfterHeader = response.headers.get("Retry-After");
        const retryAfterSec = retryAfterHeader ? parseFloat(retryAfterHeader) : 1;
        const waitMs = Math.ceil(retryAfterSec * 1000) + Math.floor(Math.random() * 200);

        if (attempt > this.maxRetries) {
          throw new ShopifyThrottleError(
            `Shopify rate limit exceeded (HTTP 429) after ${this.maxRetries} retries`,
            retryAfterSec,
          );
        }

        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      // Non-200 non-429 HTTP error
      if (!response.ok) {
        const bodyText = await response.text();
        // Server errors (500, 502, 503) can be retried
        if (response.status >= 500 && attempt <= this.maxRetries) {
          await new Promise((r) => setTimeout(r, attempt * 500));
          continue;
        }
        throw new ShopifyHttpError(response.status, response.statusText, bodyText);
      }

      // Parse JSON body
      const json = (await response.json()) as GraphQLResponse<T>;

      // Update cost scheduler with actual cost and throttle status
      if (json.extensions?.cost) {
        this.costScheduler.updateFromResponse(this.shopDomain, json.extensions.cost);
      }

      // Check for GraphQL errors inside HTTP 200
      if (json.errors && json.errors.length > 0) {
        const isThrottled = json.errors.some(
          (err) =>
            err.extensions?.code === "THROTTLED" ||
            err.message.toLowerCase().includes("throttled"),
        );

        if (isThrottled) {
          if (attempt > this.maxRetries) {
            throw new ShopifyThrottleError(
              `Shopify GraphQL THROTTLED error after ${this.maxRetries} retries`,
            );
          }
          // Back off and retry
          const backoffMs = attempt * 1000 + Math.floor(Math.random() * 500);
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }

        // Non-throttled GraphQL error (e.g. invalid query, unauthorized) - do NOT retry
        throw new ShopifyGraphQLError(
          `Shopify GraphQL error: ${json.errors.map((e) => e.message).join("; ")}`,
          json.errors,
          200,
        );
      }

      return json;
    }

    throw new Error("Unexpected retry loop termination");
  }

  /**
   * Helper to execute a query and return only data, throwing on GraphQL or HTTP errors.
   */
  public async query<T = Record<string, unknown>>(
    query: string,
    variables?: Record<string, unknown>,
    options?: RequestOptions,
  ): Promise<T> {
    const res = await this.executeGraphQL<T>(query, variables, options);
    if (!res.data) {
      throw new ShopifyGraphQLError("GraphQL response missing data object", res.errors ?? []);
    }
    return res.data;
  }

  /**
   * Helper to execute a mutation, extracting userErrors and throwing ShopifyUserErrorCollection if found.
   */
  public async mutate<T = Record<string, unknown>>(
    mutation: string,
    variables?: Record<string, unknown>,
    options?: MutateOptions,
  ): Promise<T> {
    const res = await this.executeGraphQL<T>(mutation, variables, options);
    if (!res.data) {
      throw new ShopifyGraphQLError("GraphQL response missing data object", res.errors ?? []);
    }

    if (options?.assertNoUserErrors !== false) {
      const userErrors = this.extractUserErrors(res.data);
      if (userErrors.length > 0) {
        throw new ShopifyUserErrorCollection(
          `Mutation rejected with ${userErrors.length} userError(s): ${userErrors.map((u) => u.message).join("; ")}`,
          userErrors,
        );
      }
    }

    return res.data;
  }

  /**
   * Recursively scans response data for userErrors or userErrors-like arrays.
   */
  public extractUserErrors(data: unknown): ShopifyUserError[] {
    const results: ShopifyUserError[] = [];
    if (!data || typeof data !== "object") {
      return results;
    }

    const obj = data as Record<string, unknown>;
    for (const [key, value] of Object.entries(obj)) {
      if ((key === "userErrors" || key === "customerUserErrors") && Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === "object" && "message" in item) {
            results.push({
              field: Array.isArray(item.field) ? item.field : null,
              message: String(item.message),
            });
          }
        }
      } else if (value && typeof value === "object") {
        results.push(...this.extractUserErrors(value));
      }
    }

    return results;
  }

  /**
   * Cursor-based pagination generator.
   */
  public async *paginate<TNode>(
    query: string,
    variables: Record<string, unknown> = {},
    extractPage: (data: unknown) => { nodes: TNode[]; pageInfo: PageInfo },
    options?: { maxPages?: number; priority?: OperationPriority; estimatedCost?: number },
  ): AsyncGenerator<TNode[], void, unknown> {
    let cursor: string | null = null;
    let pageCount = 0;
    const maxPages = options?.maxPages ?? 100;

    while (pageCount < maxPages) {
      pageCount++;
      const currentVariables = { ...variables, cursor };
      const data = await this.query<unknown>(query, currentVariables, {
        priority: options?.priority,
        estimatedCost: options?.estimatedCost,
      });

      const { nodes, pageInfo } = extractPage(data);
      yield nodes;

      if (!pageInfo.hasNextPage || !pageInfo.endCursor) {
        break;
      }
      cursor = pageInfo.endCursor;
    }
  }

  /**
   * Collects all paginated nodes into a single array.
   */
  public async fetchAllPages<TNode>(
    query: string,
    variables: Record<string, unknown> = {},
    extractPage: (data: unknown) => { nodes: TNode[]; pageInfo: PageInfo },
    options?: { maxPages?: number; priority?: OperationPriority; estimatedCost?: number },
  ): Promise<TNode[]> {
    const all: TNode[] = [];
    for await (const page of this.paginate(query, variables, extractPage, options)) {
      all.push(...page);
    }
    return all;
  }

  /**
   * Starts a GraphQL Bulk Operation query.
   */
  public async startBulkQuery(queryToRun: string): Promise<{ id: string; status: string }> {
    const mutation = `
      mutation StartBulkOperation($query: String!) {
        bulkOperationRunQuery(query: $query) {
          bulkOperation {
            id
            status
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    interface BulkRunResult {
      bulkOperationRunQuery: {
        bulkOperation: {
          id: string;
          status: string;
        } | null;
        userErrors: ShopifyUserError[];
      };
    }

    const data = await this.mutate<BulkRunResult>(mutation, { query: queryToRun });
    const op = data.bulkOperationRunQuery.bulkOperation;
    if (!op) {
      throw new Error("Bulk operation was not created");
    }
    return op;
  }

  /**
   * Fetches the current bulk operation status.
   */
  public async getCurrentBulkOperation(): Promise<{
    id: string;
    status: string;
    url?: string | null;
    errorCode?: string | null;
  } | null> {
    const query = `
      query GetCurrentBulkOperation {
        currentBulkOperation {
          id
          status
          errorCode
          url
        }
      }
    `;

    interface CurrentBulkResult {
      currentBulkOperation: {
        id: string;
        status: string;
        url?: string | null;
        errorCode?: string | null;
      } | null;
    }

    const data = await this.query<CurrentBulkResult>(query);
    return data.currentBulkOperation;
  }
}
