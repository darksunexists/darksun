import { v4 } from "uuid";
import pg from "pg";
type Pool = pg.Pool;

import {
    Account,
    Actor,
    DatabaseAdapter,
    EmbeddingProvider,
    GoalStatus,
    Participant,
    RAGKnowledgeItem,
    elizaLogger,
    getEmbeddingConfig,
    getEnvVariable,
    type Goal,
    type IDatabaseCacheAdapter,
    type Memory,
    type Relationship,
    type UUID,
} from "@elizaos/core";
import fs from "fs";
import path from "path";

import {
    QueryConfig,
    QueryConfigValues,
    QueryResult,
    QueryResultRow,
} from "pg";
import { fileURLToPath } from "url";

import type {
    BackroomEntry,
    ConversationMessage,
    RelationType,
    ScrappedArticle,
    ArticleVersion,
    Article,
    ArticleSource,
    ClusterWithBackrooms,
    ArticleRelation,
    UnclusterableBackroom,
} from "./types";

export type BackroomEntryParams = Omit<BackroomEntry, 'id' | 'created_at' | 'upvotes'>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class PostgresDatabaseAdapter
    extends DatabaseAdapter<Pool>
    implements IDatabaseCacheAdapter
{
    private pool: Pool;
    private readonly maxRetries: number = 3;
    private readonly baseDelay: number = 1000;
    private readonly maxDelay: number = 10000;
    private readonly jitterMax: number = 1000;
    private readonly connectionTimeout: number = 5000;

    constructor(connectionConfig: any) {
        super({
            failureThreshold: 5,
            resetTimeout: 60000,
            halfOpenMaxAttempts: 3,
        });

        const defaultConfig = {
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: this.connectionTimeout,
        };

        this.pool = new pg.Pool({
            ...defaultConfig,
            ...connectionConfig,
        });

        this.pool.on("error", (err) => {
            elizaLogger.error("Unexpected pool error", err);
            this.handlePoolError(err);
        });

        this.setupPoolErrorHandling();
        this.testConnection();
    }

    private setupPoolErrorHandling() {
        process.on("SIGINT", async () => {
            await this.cleanup();
            process.exit(0);
        });

        process.on("SIGTERM", async () => {
            await this.cleanup();
            process.exit(0);
        });

        process.on("beforeExit", async () => {
            await this.cleanup();
        });
    }

    private async withDatabase<T>(
        operation: () => Promise<T>,
        context: string
    ): Promise<T> {
        return this.withCircuitBreaker(async () => {
            return this.withRetry(operation);
        }, context);
    }

    private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
        let lastError: Error = new Error("Unknown error");

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error as Error;

                if (attempt < this.maxRetries) {
                    const backoffDelay = Math.min(
                        this.baseDelay * Math.pow(2, attempt - 1),
                        this.maxDelay
                    );
                    const jitter = Math.random() * this.jitterMax;
                    const delay = backoffDelay + jitter;

                    elizaLogger.warn(
                        `Database operation failed (attempt ${attempt}/${this.maxRetries}):`,
                        {
                            error:
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                            nextRetryIn: `${(delay / 1000).toFixed(1)}s`,
                        }
                    );

                    await new Promise((resolve) => setTimeout(resolve, delay));
                } else {
                    elizaLogger.error("Max retry attempts reached:", {
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                        totalAttempts: attempt,
                    });
                    throw error instanceof Error
                        ? error
                        : new Error(String(error));
                }
            }
        }

        throw lastError;
    }

    private async handlePoolError(error: Error) {
        elizaLogger.error("Pool error occurred, attempting to reconnect", {
            error: error.message,
        });

        try {
            await this.pool.end();
            this.pool = new pg.Pool({
                ...this.pool.options,
                connectionTimeoutMillis: this.connectionTimeout,
            });
            await this.testConnection();
            elizaLogger.success("Pool reconnection successful");
        } catch (reconnectError) {
            elizaLogger.error("Failed to reconnect pool", {
                error:
                    reconnectError instanceof Error
                        ? reconnectError.message
                        : String(reconnectError),
            });
            throw reconnectError;
        }
    }

    async query<R extends QueryResultRow = any, I = any[]>(
        queryTextOrConfig: string | QueryConfig<I>,
        values?: QueryConfigValues<I>
    ): Promise<QueryResult<R>> {
        return this.withDatabase(async () => {
            return await this.pool.query(queryTextOrConfig, values);
        }, "query");
    }

    private async validateVectorSetup(): Promise<boolean> {
        try {
            const vectorExt = await this.query(`
                SELECT 1 FROM pg_extension WHERE extname = 'vector'
            `);
            const hasVector = vectorExt.rows.length > 0;

            if (!hasVector) {
                elizaLogger.error("Vector extension not found in database");
                return false;
            }

            return true;
        } catch (error) {
            elizaLogger.error("Failed to validate vector extension:", {
                error: error instanceof Error ? error.message : String(error),
            });
            return false;
        }
    }

    async init() {
        await this.testConnection();

        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");

            const embeddingConfig = getEmbeddingConfig();
            if (embeddingConfig.provider === EmbeddingProvider.OpenAI) {
                await client.query("SET app.use_openai_embedding = 'true'");
                await client.query("SET app.use_ollama_embedding = 'false'");
                await client.query("SET app.use_gaianet_embedding = 'false'");
            } else if (embeddingConfig.provider === EmbeddingProvider.Ollama) {
                await client.query("SET app.use_openai_embedding = 'false'");
                await client.query("SET app.use_ollama_embedding = 'true'");
                await client.query("SET app.use_gaianet_embedding = 'false'");
            } else if (embeddingConfig.provider === EmbeddingProvider.GaiaNet) {
                await client.query("SET app.use_openai_embedding = 'false'");
                await client.query("SET app.use_ollama_embedding = 'false'");
                await client.query("SET app.use_gaianet_embedding = 'true'");
            } else {
                await client.query("SET app.use_openai_embedding = 'false'");
                await client.query("SET app.use_ollama_embedding = 'false'");
            }

            const { rows } = await client.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables
                    WHERE table_name = 'rooms'
                );
            `);

            if (!rows[0].exists || !(await this.validateVectorSetup())) {
                elizaLogger.info(
                    "Applying database schema - tables or vector extension missing"
                );
                const schema = fs.readFileSync(
                    path.resolve(__dirname, "../schema.sql"),
                    "utf8"
                );
                await client.query(schema);
            }

            await client.query("COMMIT");
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    }

    async close() {
        await this.pool.end();
    }

    async testConnection(): Promise<boolean> {
        let client;
        try {
            client = await this.pool.connect();
            const result = await client.query("SELECT NOW()");
            elizaLogger.success(
                "Database connection test successful:",
                result.rows[0]
            );
            return true;
        } catch (error) {
            elizaLogger.error("Database connection test failed:", error);
            throw new Error(
                `Failed to connect to database: ${(error as Error).message}`
            );
        } finally {
            if (client) client.release();
        }
    }

    async cleanup(): Promise<void> {
        try {
            await this.pool.end();
            elizaLogger.info("Database pool closed");
        } catch (error) {
            elizaLogger.error("Error closing database pool:", error);
        }
    }

    async getRoom(roomId: UUID): Promise<UUID | null> {
        return this.withDatabase(async () => {
            const { rows } = await this.pool.query(
                "SELECT id FROM rooms WHERE id = $1",
                [roomId]
            );
            return rows.length > 0 ? (rows[0].id as UUID) : null;
        }, "getRoom");
    }

    async getParticipantsForAccount(userId: UUID): Promise<Participant[]> {
        return this.withDatabase(async () => {
            const { rows } = await this.pool.query(
                `SELECT
                    id,
                    "userId",
                    "roomId",
                    "last_message_read"
                FROM participants
                WHERE "userId" = $1`,
                [userId]
            );
            return rows as Participant[];
        }, "getParticipantsForAccount");
    }

    async getParticipantUserState(
        roomId: UUID,
        userId: UUID
    ): Promise<"FOLLOWED" | "MUTED" | null> {
        return this.withDatabase(async () => {
            const { rows } = await this.pool.query(
                `SELECT "userState"
                FROM participants
                WHERE "roomId" = $1 AND "userId" = $2`,
                [roomId, userId]
            );
            return rows.length > 0 ? rows[0].userState : null;
        }, "getParticipantUserState");
    }

    async getMemoriesByRoomIds(params: {
        roomIds: UUID[];
        agentId?: UUID;
        tableName: string;
        limit?: number;
    }): Promise<Memory[]> {
        return this.withDatabase(async () => {
            if (params.roomIds.length === 0) return [];
            const placeholders = params.roomIds
                .map((_, i) => `$${i + 2}`)
                .join(", ");

            let query = `SELECT *
                         FROM memories
                         WHERE type = $1 AND "roomId" IN (${placeholders})`;
            let queryParams = [params.tableName, ...params.roomIds];

            if (params.agentId) {
                query += ` AND "agentId" = $${params.roomIds.length + 2}`;
                queryParams = [...queryParams, params.agentId];
            }

            query += ` ORDER BY "createdAt" DESC`;
            if (params.limit) {
                query += ` LIMIT $${queryParams.length + 1}`;
                queryParams.push(params.limit.toString());
            }

            const { rows } = await this.pool.query(query, queryParams);
            return rows.map((row) => ({
                ...row,
                content:
                    typeof row.content === "string"
                        ? JSON.parse(row.content)
                        : row.content,
            }));
        }, "getMemoriesByRoomIds");
    }

    async setParticipantUserState(
        roomId: UUID,
        userId: UUID,
        state: "FOLLOWED" | "MUTED" | null
    ): Promise<void> {
        return this.withDatabase(async () => {
            await this.pool.query(
                `UPDATE participants
                 SET "userState" = $1
                 WHERE "roomId" = $2 AND "userId" = $3`,
                [state, roomId, userId]
            );
        }, "setParticipantUserState");
    }

    async getParticipantsForRoom(roomId: UUID): Promise<UUID[]> {
        return this.withDatabase(async () => {
            const { rows } = await this.pool.query(
                `SELECT "userId"
                 FROM participants
                 WHERE "roomId" = $1`,
                [roomId]
            );
            return rows.map((row) => row.userId);
        }, "getParticipantsForRoom");
    }

    async getAccountById(userId: UUID): Promise<Account | null> {
        return this.withDatabase(async () => {
            const { rows } = await this.pool.query(
                "SELECT * FROM accounts WHERE id = $1",
                [userId]
            );
            if (rows.length === 0) {
                elizaLogger.debug("Account not found:", { userId });
                return null;
            }

            const account = rows[0];
            return {
                ...account,
                details:
                    typeof account.details === "string"
                        ? JSON.parse(account.details)
                        : account.details,
            };
        }, "getAccountById");
    }

    async createAccount(account: Account): Promise<boolean> {
        return this.withDatabase(async () => {
            try {
                const accountId = account.id ?? v4();
                await this.pool.query(
                    `INSERT INTO accounts (
                        id,
                        name,
                        username,
                        email,
                        "avatarUrl",
                        details
                    ) VALUES ($1, $2, $3, $4, $5, $6)`,
                    [
                        accountId,
                        account.name,
                        account.username || "",
                        account.email || "",
                        account.avatarUrl || "",
                        JSON.stringify(account.details),
                    ]
                );
                elizaLogger.debug("Account created successfully:", { accountId });
                return true;
            } catch (error) {
                elizaLogger.error("Error creating account:", {
                    error: error instanceof Error ? error.message : String(error),
                    accountId: account.id,
                    name: account.name,
                });
                return false;
            }
        }, "createAccount");
    }

    async getActorById(params: { roomId: UUID }): Promise<Actor[]> {
        return this.withDatabase(async () => {
            const { rows } = await this.pool.query(
                `SELECT
                    a.id,
                    a.name,
                    a.username,
                    a.details
                 FROM participants p
                 LEFT JOIN accounts a ON p."userId" = a.id
                 WHERE p."roomId" = $1`,
                [params.roomId]
            );

            elizaLogger.debug("Retrieved actors:", {
                roomId: params.roomId,
                actorCount: rows.length,
            });

            return rows.map((row) => {
                try {
                    return {
                        ...row,
                        details:
                            typeof row.details === "string"
                                ? JSON.parse(row.details)
                                : row.details,
                    };
                } catch (error) {
                    elizaLogger.warn("Failed to parse actor details:", {
                        actorId: row.id,
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    });
                    return {
                        ...row,
                        details: {},
                    };
                }
            });
        }, "getActorById").catch((error) => {
            elizaLogger.error("Failed to get actors:", {
                roomId: params.roomId,
                error: error.message,
            });
            throw error;
        });
    }

    async getMemoryById(id: UUID): Promise<Memory | null> {
        return this.withDatabase(async () => {
            const { rows } = await this.pool.query(
                "SELECT * FROM memories WHERE id = $1",
                [id]
            );
            if (rows.length === 0) return null;

            return {
                ...rows[0],
                content:
                    typeof rows[0].content === "string"
                        ? JSON.parse(rows[0].content)
                        : rows[0].content,
            };
        }, "getMemoryById");
    }

    async createMemory(memory: Memory, tableName: string): Promise<void> {
        return this.withDatabase(async () => {
            elizaLogger.debug("PostgresAdapter createMemory:", {
                memoryId: memory.id,
                embeddingLength: memory.embedding?.length,
                contentLength: memory.content?.text?.length,
            });

            let isUnique = true;
            if (memory.embedding) {
                const similarMemories = await this.searchMemoriesByEmbedding(
                    memory.embedding,
                    {
                        tableName,
                        roomId: memory.roomId,
                        match_threshold: 0.95,
                        count: 1,
                    }
                );
                isUnique = similarMemories.length === 0;
            }

            await this.pool.query(
                `INSERT INTO memories (
                    id,
                    type,
                    content,
                    embedding,
                    "userId",
                    "roomId",
                    "agentId",
                    "unique",
                    "createdAt"
                ) VALUES ($1, $2, $3, $4, $5::uuid, $6::uuid, $7::uuid, $8, to_timestamp($9/1000.0))`,
                [
                    memory.id ?? v4(),
                    tableName,
                    JSON.stringify(memory.content),
                    memory.embedding ? `[${memory.embedding.join(",")}]` : null,
                    memory.userId,
                    memory.roomId,
                    memory.agentId,
                    memory.unique ?? isUnique,
                    Date.now(),
                ]
            );
        }, "createMemory");
    }

    async searchMemories(params: {
        tableName: string;
        agentId: UUID;
        roomId: UUID;
        embedding: number[];
        match_threshold: number;
        match_count: number;
        unique: boolean;
    }): Promise<Memory[]> {
        return await this.searchMemoriesByEmbedding(params.embedding, {
            match_threshold: params.match_threshold,
            count: params.match_count,
            agentId: params.agentId,
            roomId: params.roomId,
            unique: params.unique,
            tableName: params.tableName,
        });
    }

    async getMemories(params: {
        roomId: UUID;
        count?: number;
        unique?: boolean;
        tableName: string;
        agentId?: UUID;
        start?: number;
        end?: number;
    }): Promise<Memory[]> {
        elizaLogger.debug("getMemories:", { params });
        if (!params.tableName) throw new Error("tableName is required");
        if (!params.roomId) throw new Error("roomId is required");

        return this.withDatabase(async () => {
            let sql = `SELECT *
                       FROM memories
                       WHERE type = $1 AND "roomId" = $2`;
            const values: any[] = [params.tableName, params.roomId];
            let paramCount = 2;

            if (params.start) {
                paramCount++;
                sql += ` AND "createdAt" >= to_timestamp($${paramCount})`;
                values.push(params.start / 1000);
            }

            if (params.end) {
                paramCount++;
                sql += ` AND "createdAt" <= to_timestamp($${paramCount})`;
                values.push(params.end / 1000);
            }

            if (params.unique) {
                sql += ` AND "unique" = true`;
            }

            if (params.agentId) {
                paramCount++;
                sql += ` AND "agentId" = $${paramCount}`;
                values.push(params.agentId);
            }

            sql += ' ORDER BY "createdAt" DESC';

            if (params.count) {
                paramCount++;
                sql += ` LIMIT $${paramCount}`;
                values.push(params.count);
            }

            elizaLogger.debug("Fetching memories:", {
                roomId: params.roomId,
                tableName: params.tableName,
                unique: params.unique,
                agentId: params.agentId,
                timeRange:
                    params.start || params.end
                        ? {
                              start: params.start
                                  ? new Date(params.start).toISOString()
                                  : undefined,
                              end: params.end
                                  ? new Date(params.end).toISOString()
                                  : undefined,
                          }
                        : undefined,
                limit: params.count,
            });

            const { rows } = await this.pool.query(sql, values);
            return rows.map((row) => ({
                ...row,
                content:
                    typeof row.content === "string"
                        ? JSON.parse(row.content)
                        : row.content,
            }));
        }, "getMemories");
    }

    async getGoals(params: {
        roomId: UUID;
        userId?: UUID | null;
        onlyInProgress?: boolean;
        count?: number;
    }): Promise<Goal[]> {
        return this.withDatabase(async () => {
            let sql = `SELECT * FROM goals WHERE "roomId" = $1`;
            const values: any[] = [params.roomId];
            let paramCount = 1;

            if (params.userId) {
                paramCount++;
                sql += ` AND "userId" = $${paramCount}`;
                values.push(params.userId);
            }

            if (params.onlyInProgress) {
                sql += " AND status = 'IN_PROGRESS'";
            }

            if (params.count) {
                paramCount++;
                sql += ` LIMIT $${paramCount}`;
                values.push(params.count);
            }

            const { rows } = await this.pool.query(sql, values);
            return rows.map((row) => ({
                ...row,
                objectives:
                    typeof row.objectives === "string"
                        ? JSON.parse(row.objectives)
                        : row.objectives,
            }));
        }, "getGoals");
    }

    async updateGoal(goal: Goal): Promise<void> {
        return this.withDatabase(async () => {
            try {
                await this.pool.query(
                    `UPDATE goals
                     SET
                        name = $1,
                        status = $2,
                        objectives = $3
                     WHERE id = $4`,
                    [
                        goal.name,
                        goal.status,
                        JSON.stringify(goal.objectives),
                        goal.id,
                    ]
                );
            } catch (error) {
                elizaLogger.error("Failed to update goal:", {
                    goalId: goal.id,
                    error:
                        error instanceof Error ? error.message : String(error),
                    status: goal.status,
                });
                throw error;
            }
        }, "updateGoal");
    }

    async createGoal(goal: Goal): Promise<void> {
        return this.withDatabase(async () => {
            await this.pool.query(
                `INSERT INTO goals (
                    id,
                    "roomId",
                    "userId",
                    name,
                    status,
                    objectives
                ) VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                    goal.id ?? v4(),
                    goal.roomId,
                    goal.userId,
                    goal.name,
                    goal.status,
                    JSON.stringify(goal.objectives),
                ]
            );
        }, "createGoal");
    }

    async removeGoal(goalId: UUID): Promise<void> {
        if (!goalId) throw new Error("Goal ID is required");

        return this.withDatabase(async () => {
            try {
                const result = await this.pool.query(
                    "DELETE FROM goals WHERE id = $1 RETURNING id",
                    [goalId]
                );

                elizaLogger.debug("Goal removal attempt:", {
                    goalId,
                    removed: result?.rowCount ?? 0 > 0,
                });
            } catch (error) {
                elizaLogger.error("Failed to remove goal:", {
                    goalId,
                    error:
                        error instanceof Error ? error.message : String(error),
                });
                throw error;
            }
        }, "removeGoal");
    }

    async createRoom(roomId?: UUID): Promise<UUID> {
        return this.withDatabase(async () => {
            const newRoomId = roomId || v4();
            await this.pool.query(
                "INSERT INTO rooms (id) VALUES ($1)",
                [newRoomId]
            );
            return newRoomId as UUID;
        }, "createRoom");
    }

    async removeRoom(roomId: UUID): Promise<void> {
        if (!roomId) throw new Error("Room ID is required");

        return this.withDatabase(async () => {
            const client = await this.pool.connect();
            try {
                await client.query("BEGIN");

                const checkResult = await client.query(
                    "SELECT id FROM rooms WHERE id = $1",
                    [roomId]
                );

                if (checkResult.rowCount === 0) {
                    elizaLogger.warn("No room found to remove:", { roomId });
                    throw new Error(`Room not found: ${roomId}`);
                }

                await client.query(
                    `DELETE FROM memories WHERE "roomId" = $1`,
                    [roomId]
                );
                await client.query(
                    `DELETE FROM participants WHERE "roomId" = $1`,
                    [roomId]
                );
                await client.query(
                    `DELETE FROM goals WHERE "roomId" = $1`,
                    [roomId]
                );

                const result = await client.query(
                    "DELETE FROM rooms WHERE id = $1 RETURNING id",
                    [roomId]
                );

                await client.query("COMMIT");

                elizaLogger.debug(
                    "Room and related data removed successfully:",
                    {
                        roomId,
                        removed: result?.rowCount ?? 0 > 0,
                    }
                );
            } catch (error) {
                await client.query("ROLLBACK");
                elizaLogger.error("Failed to remove room:", {
                    roomId,
                    error:
                        error instanceof Error ? error.message : String(error),
                });
                throw error;
            } finally {
                if (client) client.release();
            }
        }, "removeRoom");
    }

    async createRelationship(params: {
        userA: UUID;
        userB: UUID;
    }): Promise<boolean> {
        if (!params.userA || !params.userB) {
            throw new Error("userA and userB are required");
        }

        return this.withDatabase(async () => {
            try {
                const relationshipId = v4();
                await this.pool.query(
                    `INSERT INTO relationships (
                        id,
                        "userA",
                        "userB",
                        "userId"
                    ) VALUES ($1, $2, $3, $4)
                    RETURNING id`,
                    [relationshipId, params.userA, params.userB, params.userA]
                );

                elizaLogger.debug("Relationship created successfully:", {
                    relationshipId,
                    userA: params.userA,
                    userB: params.userB,
                });

                return true;
            } catch (error) {
                if ((error as { code?: string }).code === "23505") {
                    elizaLogger.warn("Relationship already exists:", {
                        userA: params.userA,
                        userB: params.userB,
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    });
                } else {
                    elizaLogger.error("Failed to create relationship:", {
                        userA: params.userA,
                        userB: params.userB,
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    });
                }
                return false;
            }
        }, "createRelationship");
    }

    async getRelationship(params: {
        userA: UUID;
        userB: UUID;
    }): Promise<Relationship | null> {
        if (!params.userA || !params.userB) {
            throw new Error("userA and userB are required");
        }

        return this.withDatabase(async () => {
            try {
                const { rows } = await this.pool.query(
                    `SELECT *
                     FROM relationships
                     WHERE ("userA" = $1 AND "userB" = $2)
                        OR ("userA" = $2 AND "userB" = $1)`,
                    [params.userA, params.userB]
                );

                if (rows.length > 0) {
                    elizaLogger.debug("Relationship found:", {
                        relationshipId: rows[0].id,
                        userA: params.userA,
                        userB: params.userB,
                    });
                    return rows[0];
                }

                elizaLogger.debug("No relationship found between users:", {
                    userA: params.userA,
                    userB: params.userB,
                });
                return null;
            } catch (error) {
                elizaLogger.error("Error fetching relationship:", {
                    userA: params.userA,
                    userB: params.userB,
                    error:
                        error instanceof Error ? error.message : String(error),
                });
                throw error;
            }
        }, "getRelationship");
    }

    async getRelationships(params: { userId: UUID }): Promise<Relationship[]> {
        if (!params.userId) {
            throw new Error("userId is required");
        }

        return this.withDatabase(async () => {
            try {
                const { rows } = await this.pool.query(
                    `SELECT *
                     FROM relationships
                     WHERE "userA" = $1 OR "userB" = $1
                     ORDER BY "createdAt" DESC`,
                    [params.userId]
                );

                elizaLogger.debug("Retrieved relationships:", {
                    userId: params.userId,
                    count: rows.length,
                });

                return rows;
            } catch (error) {
                elizaLogger.error("Failed to fetch relationships:", {
                    userId: params.userId,
                    error:
                        error instanceof Error ? error.message : String(error),
                });
                throw error;
            }
        }, "getRelationships");
    }

    async getCachedEmbeddings(opts: {
        query_table_name: string;
        query_threshold: number;
        query_input: string;
        query_field_name: string;
        query_field_sub_name: string;
        query_match_count: number;
    }): Promise<{ embedding: number[]; levenshtein_score: number }[]> {
        if (!opts.query_table_name)
            throw new Error("query_table_name is required");
        if (!opts.query_input) throw new Error("query_input is required");
        if (!opts.query_field_name)
            throw new Error("query_field_name is required");
        if (!opts.query_field_sub_name)
            throw new Error("query_field_sub_name is required");
        if (opts.query_match_count <= 0)
            throw new Error("query_match_count must be positive");

        return this.withDatabase(async () => {
            try {
                elizaLogger.debug("Fetching cached embeddings:", {
                    tableName: opts.query_table_name,
                    fieldName: opts.query_field_name,
                    subFieldName: opts.query_field_sub_name,
                    matchCount: opts.query_match_count,
                    inputLength: opts.query_input.length,
                });

                const sql = `
                    WITH content_text AS (
                        SELECT
                            embedding,
                            COALESCE(
                                content->$2->>$3,
                                ''
                            ) AS content_text
                        FROM memories
                        WHERE type = $4
                        AND content->$2->>$3 IS NOT NULL
                    )
                    SELECT
                        embedding,
                        levenshtein(
                            $1,
                            content_text
                        ) AS levenshtein_score
                    FROM content_text
                    WHERE levenshtein(
                        $1,
                        content_text
                    ) <= $6
                    ORDER BY levenshtein_score
                    LIMIT $5
                `;

                const { rows } = await this.pool.query(sql, [
                    opts.query_input,
                    opts.query_field_name,
                    opts.query_field_sub_name,
                    opts.query_table_name,
                    opts.query_match_count,
                    opts.query_threshold,
                ]);

                elizaLogger.debug("Retrieved cached embeddings:", {
                    count: rows.length,
                    tableName: opts.query_table_name,
                    matchCount: opts.query_match_count,
                });

                return rows
                    .map(
                        (
                            row
                        ): {
                            embedding: number[];
                            levenshtein_score: number;
                        } | null => {
                            if (!Array.isArray(row.embedding)) return null;
                            return {
                                embedding: row.embedding,
                                levenshtein_score: Number(
                                    row.levenshtein_score
                                ),
                            };
                        }
                    )
                    .filter(
                        (
                            row
                        ): row is {
                            embedding: number[];
                            levenshtein_score: number;
                        } => row !== null
                    );
            } catch (error) {
                elizaLogger.error("Error in getCachedEmbeddings:", {
                    error:
                        error instanceof Error ? error.message : String(error),
                    tableName: opts.query_table_name,
                    fieldName: opts.query_field_name,
                });
                throw error;
            }
        }, "getCachedEmbeddings");
    }

    async log(params: {
        body: { [key: string]: unknown };
        userId: UUID;
        roomId: UUID;
        type: string;
    }): Promise<void> {
        elizaLogger.debug("log:", { params });
        if (!params.userId) throw new Error("userId is required");
        if (!params.roomId) throw new Error("roomId is required");
        if (!params.type) throw new Error("type is required");
        if (!params.body || typeof params.body !== "object") {
            throw new Error("body must be a valid object");
        }

        return this.withDatabase(async () => {
            try {
                const logId = v4();
                await this.pool.query(
                    `INSERT INTO logs (
                        id,
                        body,
                        "userId",
                        "roomId",
                        type,
                        "createdAt"
                    ) VALUES ($1, $2, $3, $4, $5, NOW())
                    RETURNING id`,
                    [
                        logId,
                        JSON.stringify(params.body),
                        params.userId,
                        params.roomId,
                        params.type,
                    ]
                );

                elizaLogger.debug("Log entry created:", {
                    logId,
                    type: params.type,
                    roomId: params.roomId,
                    userId: params.userId,
                    bodyKeys: Object.keys(params.body),
                });
            } catch (error) {
                elizaLogger.error("Failed to create log entry:", {
                    error:
                        error instanceof Error ? error.message : String(error),
                    type: params.type,
                    roomId: params.roomId,
                    userId: params.userId,
                });
                throw error;
            }
        }, "log");
    }

    async searchMemoriesByEmbedding(
        embedding: number[],
        params: {
            match_threshold?: number;
            count?: number;
            agentId?: UUID;
            roomId?: UUID;
            unique?: boolean;
            tableName: string;
        }
    ): Promise<Memory[]> {
        return this.withDatabase(async () => {
            elizaLogger.debug("Incoming vector:", {
                length: embedding.length,
                sample: embedding.slice(0, 5),
                isArray: Array.isArray(embedding),
                allNumbers: embedding.every((n) => typeof n === "number"),
            });

            if (embedding.length !== getEmbeddingConfig().dimensions) {
                throw new Error(
                    `Invalid embedding dimension: expected ${getEmbeddingConfig().dimensions}, got ${embedding.length}`
                );
            }

            const cleanVector = embedding.map((n) => {
                if (!Number.isFinite(n)) return 0;
                return Number(n.toFixed(6));
            });

            const vectorStr = `[${cleanVector.join(",")}]`;

            elizaLogger.debug("Vector debug:", {
                originalLength: embedding.length,
                cleanLength: cleanVector.length,
                sampleStr: vectorStr.slice(0, 100),
            });

            let sql = `
                SELECT *,
                    1 - (embedding <-> $1::vector(${getEmbeddingConfig().dimensions})) AS similarity
                FROM memories
                WHERE type = $2
            `;

            const values: any[] = [vectorStr, params.tableName];

            elizaLogger.debug("Query debug:", {
                sql: sql.slice(0, 200),
                paramTypes: values.map((v) => typeof v),
                vectorStrLength: vectorStr.length,
            });

            let paramCount = 2;

            if (params.unique) {
                sql += ` AND "unique" = true`;
            }

            if (params.agentId) {
                paramCount++;
                sql += ` AND "agentId" = $${paramCount}`;
                values.push(params.agentId);
            }

            if (params.roomId) {
                paramCount++;
                sql += ` AND "roomId" = $${paramCount}::uuid`;
                values.push(params.roomId);
            }

            if (params.match_threshold) {
                paramCount++;
                sql += ` AND 1 - (embedding <-> $1::vector) >= $${paramCount}`;
                values.push(params.match_threshold);
            }

            sql += ` ORDER BY embedding <-> $1::vector`;

            if (params.count) {
                paramCount++;
                sql += ` LIMIT $${paramCount}`;
                values.push(params.count);
            }

            const { rows } = await this.pool.query(sql, values);
            return rows.map((row) => ({
                ...row,
                content:
                    typeof row.content === "string"
                        ? JSON.parse(row.content)
                        : row.content,
                similarity: row.similarity,
            }));
        }, "searchMemoriesByEmbedding");
    }

    async addParticipant(userId: UUID, roomId: UUID): Promise<boolean> {
        return this.withDatabase(async () => {
            try {
                await this.pool.query(
                    `INSERT INTO participants (
                        id,
                        "userId",
                        "roomId"
                    ) VALUES ($1, $2, $3)`,
                    [v4(), userId, roomId]
                );
                return true;
            } catch (error) {
                console.log("Error adding participant", error);
                return false;
            }
        }, "addParticpant");
    }

    async removeParticipant(userId: UUID, roomId: UUID): Promise<boolean> {
        return this.withDatabase(async () => {
            try {
                await this.pool.query(
                    `DELETE FROM participants
                     WHERE "userId" = $1 AND "roomId" = $2`,
                    [userId, roomId]
                );
                return true;
            } catch (error) {
                console.log("Error removing participant", error);
                return false;
            }
        }, "removeParticipant");
    }

    async updateGoalStatus(params: {
        goalId: UUID;
        status: GoalStatus;
    }): Promise<void> {
        return this.withDatabase(async () => {
            await this.pool.query(
                "UPDATE goals SET status = $1 WHERE id = $2",
                [params.status, params.goalId]
            );
        }, "updateGoalStatus");
    }

    async removeMemory(memoryId: UUID, tableName: string): Promise<void> {
        return this.withDatabase(async () => {
            await this.pool.query(
                "DELETE FROM memories WHERE type = $1 AND id = $2",
                [tableName, memoryId]
            );
        }, "removeMemory");
    }

    async removeAllMemories(roomId: UUID, tableName: string): Promise<void> {
        return this.withDatabase(async () => {
            await this.pool.query(
                `DELETE FROM memories
                 WHERE type = $1 AND "roomId" = $2`,
                [tableName, roomId]
            );
        }, "removeAllMemories");
    }

    async countMemories(
        roomId: UUID,
        unique = true,
        tableName = ""
    ): Promise<number> {
        if (!tableName) throw new Error("tableName is required");

        return this.withDatabase(async () => {
            let sql = `SELECT COUNT(*) AS count
                       FROM memories
                       WHERE type = $1 AND "roomId" = $2`;
            if (unique) {
                sql += ` AND "unique" = true`;
            }

            const { rows } = await this.pool.query(sql, [tableName, roomId]);
            return parseInt(rows[0].count);
        }, "countMemories");
    }

    async removeAllGoals(roomId: UUID): Promise<void> {
        return this.withDatabase(async () => {
            await this.pool.query(
                `DELETE FROM goals WHERE "roomId" = $1`,
                [roomId]
            );
        }, "removeAllGoals");
    }

    async getRoomsForParticipant(userId: UUID): Promise<UUID[]> {
        return this.withDatabase(async () => {
            const { rows } = await this.pool.query(
                `SELECT "roomId"
                 FROM participants
                 WHERE "userId" = $1`,
                [userId]
            );
            return rows.map((row) => row.roomId);
        }, "getRoomsForParticipant");
    }

    async getRoomsForParticipants(userIds: UUID[]): Promise<UUID[]> {
        return this.withDatabase(async () => {
            const placeholders = userIds.map((_, i) => `$${i + 1}`).join(", ");
            const { rows } = await this.pool.query(
                `SELECT DISTINCT "roomId"
                 FROM participants
                 WHERE "userId" IN (${placeholders})`,
                userIds
            );
            return rows.map((row) => row.roomId);
        }, "getRoomsForParticipants");
    }

    async getActorDetails(params: { roomId: string }): Promise<Actor[]> {
        elizaLogger.debug("getActorDetails:", { params });
        if (!params.roomId) {
            throw new Error("roomId is required");
        }

        return this.withDatabase(async () => {
            try {
                const sql = `
                    SELECT
                        a.id,
                        a.name,
                        a.username,
                        a."avatarUrl",
                        COALESCE(a.details::jsonb, '{}'::jsonb) AS details
                    FROM participants p
                    LEFT JOIN accounts a ON p."userId" = a.id
                    WHERE p."roomId" = $1
                    ORDER BY a.name
                `;

                const result = await this.pool.query<Actor>(sql, [
                    params.roomId,
                ]);

                elizaLogger.debug("Retrieved actor details:", {
                    roomId: params.roomId,
                    actorCount: result.rows.length,
                });

                return result.rows.map((row) => {
                    try {
                        return {
                            ...row,
                            details:
                                typeof row.details === "string"
                                    ? JSON.parse(row.details)
                                    : row.details,
                        };
                    } catch (parseError) {
                        elizaLogger.warn("Failed to parse actor details:", {
                            actorId: row.id,
                            error:
                                parseError instanceof Error
                                    ? parseError.message
                                    : String(parseError),
                        });
                        return {
                            ...row,
                            details: {},
                        };
                    }
                });
            } catch (error) {
                elizaLogger.error("Failed to fetch actor details:", {
                    roomId: params.roomId,
                    error:
                        error instanceof Error ? error.message : String(error),
                });
                throw new Error(
                    `Failed to fetch actor details: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }, "getActorDetails");
    }

    async getCache(params: {
        key: string;
        agentId: UUID;
    }): Promise<string | undefined> {
        return this.withDatabase(async () => {
            try {
                const sql = `SELECT "value"::TEXT FROM cache WHERE "key" = $1 AND "agentId" = $2`;
                const { rows } = await this.query<{ value: string }>(sql, [
                    params.key,
                    params.agentId,
                ]);
                return rows[0]?.value ?? undefined;
            } catch (error) {
                elizaLogger.error("Error fetching cache", {
                    error:
                        error instanceof Error ? error.message : String(error),
                    key: params.key,
                    agentId: params.agentId,
                });
                return undefined;
            }
        }, "getCache");
    }

    async setCache(params: {
        key: string;
        agentId: UUID;
        value: string;
    }): Promise<boolean> {
        return this.withDatabase(async () => {
            try {
                const client = await this.pool.connect();
                try {
                    await client.query("BEGIN");
                    await client.query(
                        `INSERT INTO cache (
                            "key",
                            "agentId",
                            "value",
                            "createdAt"
                         ) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
                         ON CONFLICT ("key", "agentId")
                         DO UPDATE SET "value" = EXCLUDED.value, "createdAt" = CURRENT_TIMESTAMP`,
                        [params.key, params.agentId, params.value]
                    );
                    await client.query("COMMIT");
                    return true;
                } catch (error) {
                    await client.query("ROLLBACK");
                    elizaLogger.error("Error setting cache", {
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                        key: params.key,
                        agentId: params.agentId,
                    });
                    return false;
                } finally {
                    if (client) client.release();
                }
            } catch (error) {
                elizaLogger.error(
                    "Database connection error in setCache",
                    error
                );
                return false;
            }
        }, "setCache");
    }

    async deleteCache(params: {
        key: string;
        agentId: UUID;
    }): Promise<boolean> {
        return this.withDatabase(async () => {
            try {
                const client = await this.pool.connect();
                try {
                    await client.query("BEGIN");
                    await client.query(
                        `DELETE FROM cache
                         WHERE "key" = $1 AND "agentId" = $2`,
                        [params.key, params.agentId]
                    );
                    await client.query("COMMIT");
                    return true;
                } catch (error) {
                    await client.query("ROLLBACK");
                    elizaLogger.error("Error deleting cache", {
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                        key: params.key,
                        agentId: params.agentId,
                    });
                    return false;
                } finally {
                    client.release();
                }
            } catch (error) {
                elizaLogger.error(
                    "Database connection error in deleteCache",
                    error
                );
                return false;
            }
        }, "deleteCache");
    }

    async createBackroomEntry(params: Omit<BackroomEntry, 'id' | 'created_at' | 'upvotes'>): Promise<UUID> {
        return this.withDatabase(async () => {
            try {
                const { rows } = await this.pool.query(
                    `INSERT INTO backrooms (
                        id,
                        topic,
                        title,
                        question,
                        content,
                        iq_tx_hash,
                        citations,
                        tweet_url,
                        technical_terms,
                        entities,
                        claims
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                    RETURNING id`,
                    [
                        v4(),
                        params.topic,
                        params.title,
                        params.question,
                        JSON.stringify(params.content),
                        params.iqTxHash,
                        params.citations,
                        params.tweetUrl,
                        params.metadata?.technicalTerms || [],
                        params.metadata?.entities || [],
                        params.metadata?.claims || []
                    ]
                );

                elizaLogger.debug("Backroom entry created:", {
                    id: rows[0].id,
                    title: params.title,
                    participantCount: params.content.participants.length,
                    metadata: {
                        technicalTermsCount: params.metadata?.technicalTerms?.length || 0,
                        entitiesCount: params.metadata?.entities?.length || 0,
                        claimsCount: params.metadata?.claims?.length || 0
                    }
                });

                return rows[0].id;
            } catch (error) {
                elizaLogger.error("Failed to create backroom entry:", {
                    error: error instanceof Error ? error.message : String(error),
                    title: params.title,
                });
                throw error;
            }
        }, "createBackroomEntry");
    }

    async updateBackroomEntry(
        id: string,
        params: {
            metadata?: {
                technicalTerms: string[];
                entities: string[];
                claims: string[];
            }
        }
    ): Promise<void> {
        return this.withDatabase(async () => {
            try {
                const query = `
                    UPDATE backrooms
                    SET
                        technical_terms = $2,
                        entities = $3,
                        claims = $4
                    WHERE id = $1`;

                await this.pool.query(query, [
                    id,
                    params.metadata?.technicalTerms || [],
                    params.metadata?.entities || [],
                    params.metadata?.claims || []
                ]);

                elizaLogger.debug("Backroom metadata updated:", {
                    backroomId: id,
                    metadata: {
                        technicalTermsCount: params.metadata?.technicalTerms?.length || 0,
                        entitiesCount: params.metadata?.entities?.length || 0,
                        claimsCount: params.metadata?.claims?.length || 0
                    }
                });
            } catch (error) {
                elizaLogger.error("Failed to update backroom metadata:", {
                    error: error instanceof Error ? error.message : String(error),
                    backroomId: id
                });
                throw error;
            }
        }, "updateBackroomEntry");
    }

    async getBackroomEntry(id: UUID): Promise<BackroomEntry | null> {
        try {
            return this.withDatabase(async () => {
                const query = `
                    SELECT
                        b.id,
                        b.topic,
                        b.title,
                        b.question,
                        b.content::json AS content,
                        b.iq_tx_hash,
                        b.citations,
                        b.tweet_url,
                        b.created_at,
                        b.technical_terms,
                        b.entities,
                        b.claims
                    FROM backrooms b
                    WHERE b.id = $1
                `;

                const result = await this.pool.query(query, [id]);

                if (result.rows.length === 0) {
                    elizaLogger.warn("Backroom entry not found:", { id });
                    return null;
                }

                const row = result.rows[0];

                elizaLogger.debug("Backroom entry fetched:", {
                    id,
                    content: row.content,
                });

                const backroomEntry: BackroomEntry = {
                    ...row,
                    id: row.id,
                    content:
                        typeof row.content === "string"
                            ? JSON.parse(row.content)
                            : row.content,
                    citations: row.citations || [],
                    upvotes: row.upvotes || 0,
                    created_at: row.created_at,
                    metadata: {
                        technicalTerms: row.technical_terms || [],
                        entities: row.entities || [],
                        claims: row.claims || []
                    },
                }

                elizaLogger.info("Cleaned backroom entry", { backroomEntry });

                return backroomEntry;
            }, "getBackroomEntry");
        } catch (error) {
            elizaLogger.error('Error fetching backroom entry:', error);
            throw new Error(`Failed to fetch backroom entry: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async getBackroomEntriesByTopic(topic: string): Promise<BackroomEntry[]> {
        return this.withDatabase(async () => {
            try {
                const { rows } = await this.pool.query(
                    `SELECT
                        id,
                        topic,
                        title,
                        question,
                        content,
                        created_at,
                        upvotes,
                        citations,
                        tweet_url,
                        technical_terms,
                        entities,
                        claims
                    FROM backrooms
                    WHERE topic = $1
                    ORDER BY created_at DESC`,
                    [topic]
                );

                elizaLogger.debug("Retrieved backroom entries:", {
                    topic,
                    count: rows.length,
                });

                return rows.map((row) => ({
                    ...row,
                    id: row.id,
                    content:
                        typeof row.content === "string"
                            ? JSON.parse(row.content)
                            : row.content,
                    citations: row.citations || [],
                    upvotes: row.upvotes || 0,
                    created_at: row.created_at,
                    metadata: {
                        technicalTerms: row.technical_terms || [],
                        entities: row.entities || [],
                        claims: row.claims || []
                    },
                }) as BackroomEntry);
            } catch (error) {
                elizaLogger.error("Failed to retrieve backroom entries:", {
                    error:
                        error instanceof Error ? error.message : String(error),
                    topic,
                });
                throw error;
            }
        }, "getBackroomEntriesByTopic");
    }

    async getBackroomsByArticleId(articleId: number): Promise<
        {
            id: string;
            topic: string;
            title: string;
            question: string;
            content: {
                participants: string[];
                messages: ConversationMessage[];
            };
            created_at: Date;
        }[]
    > {
        return this.withDatabase(async () => {
            try {
                const { rows } = await this.pool.query(
                    `SELECT
                        b.id,
                        b.topic,
                        b.title,
                        b.question,
                        b.content,
                        b.created_at
                    FROM backrooms b
                    JOIN articles a ON b.id = a.backroom_id
                    WHERE a.id = $1
                    ORDER BY b.created_at DESC`,
                    [articleId]
                );

                elizaLogger.debug("Retrieved backroom for article:", {
                    articleId,
                    count: rows.length,
                });

                return rows.map((row) => ({
                    ...row,
                    id: row.id,
                    content:
                        typeof row.content === "string"
                            ? JSON.parse(row.content)
                            : row.content,
                    citations: row.citations || [],
                    upvotes: row.upvotes || 0,
                    created_at: row.created_at,
                    metadata: {
                        technicalTerms: row.technical_terms || [],
                        entities: row.entities || [],
                        claims: row.claims || []
                    },
                }) as BackroomEntry);
            } catch (error) {
                elizaLogger.error("Failed to retrieve backroom for article:", {
                    error:
                        error instanceof Error ? error.message : String(error),
                    articleId,
                });
                throw error;
            }
        }, "getBackroomsByArticleId");
    }

    async getBackroomsByArticles(articleIds: number[]): Promise<BackroomEntry[]> {
        const client = await this.pool.connect();
        try {
            const { rows } = await client.query(`
                SELECT b.*
                FROM backrooms b
                JOIN article_sources src ON b.id = src.backroom_id
                WHERE src.article_id = ANY($1::bigint[])
            `, [articleIds]);

            return rows.map((row) => ({
                ...row,
                id: row.id,
                content:
                    typeof row.content === "string"
                        ? JSON.parse(row.content)
                        : row.content,
                citations: row.citations || [],
                upvotes: row.upvotes || 0,
                created_at: row.created_at,
                metadata: {
                    technicalTerms: row.technical_terms || [],
                    entities: row.entities || [],
                    claims: row.claims || []
                },
            }) as BackroomEntry);
        } finally {
            client.release();
        }
    }

    async getBackroomMetadata(id: string): Promise<{
        technicalTerms: string[];
        entities: string[];
        claims: string[];
    } | null> {
        return this.withDatabase(async () => {
            try {
                const query = `
                    SELECT
                        technical_terms,
                        entities,
                        claims
                    FROM backrooms
                    WHERE id = $1
                `;

                const result = await this.pool.query(query, [id]);

                if (result.rows.length === 0) {
                    return null;
                }

                const row = result.rows[0];

                elizaLogger.debug("Retrieved backroom metadata:", {
                    backroomId: id,
                    metadata: {
                        technicalTermsCount: row.technical_terms?.length || 0,
                        entitiesCount: row.entities?.length || 0,
                        claimsCount: row.claims?.length || 0
                    }
                });

                return {
                    technicalTerms: row.technical_terms || [],
                    entities: row.entities || [],
                    claims: row.claims || []
                };
            } catch (error) {
                elizaLogger.error("Failed to retrieve backroom metadata:", {
                    error: error instanceof Error ? error.message : String(error),
                    backroomId: id
                });
                throw error;
            }
        }, "getBackroomMetadata");
    }

    async getBackroomRelation(sourceId: string, relatedId: string): Promise<number | null> {
        elizaLogger.debug("Getting backroom relation", {
            sourceId,
            relatedId,
        });

        return this.withDatabase(async () => {
            const { rows } = await this.pool.query(
                `SELECT similarity_score
                 FROM backroom_relations
                 WHERE (source_backroom_id = $1 AND related_backroom_id = $2)
                    OR (source_backroom_id = $2 AND related_backroom_id = $1)`,
                [sourceId, relatedId]
            );

            elizaLogger.debug("Retrieved backroom relation:", {
                sourceId,
                relatedId,
                found: rows.length > 0,
                result: rows[0]?.similarity_score
            });

            return rows.length > 0 ? rows[0].similarity_score : null;
        }, "getBackroomRelation");
    }

    async getBackroomSimilarityScores(backroomId: string, otherBackroomIds: string[]): Promise<Record<string, number>> {
        return this.withDatabase(async () => {
            if (!otherBackroomIds.length) return {};

            const { rows } = await this.pool.query(
                `SELECT
                    CASE
                        WHEN source_backroom_id = $1 THEN related_backroom_id
                        ELSE source_backroom_id
                    END AS other_id,
                    similarity_score
                FROM backroom_relations
                WHERE (source_backroom_id = $1 AND related_backroom_id = ANY($2::uuid[]))
                   OR (related_backroom_id = $1 AND source_backroom_id = ANY($2::uuid[]))`,
                [backroomId, otherBackroomIds]
            );

            return rows.reduce((acc, row) => {
                acc[row.other_id] = row.similarity_score;
                return acc;
            }, {} as Record<string, number>);
        }, "getBackroomSimilarityScores");
    }

    async createBackroomRelation(sourceId: string, relatedId: string, similarityScore: number): Promise<void> {
        elizaLogger.debug("Creating backroom relation", {
            sourceId,
            relatedId,
            similarityScore,
            type: typeof similarityScore,
        });

        return this.withDatabase(async () => {
            const { rows } = await this.pool.query(
                `SELECT id FROM backroom_relations
                 WHERE (source_backroom_id = $2 AND related_backroom_id = $1)`,
                [sourceId, relatedId]
            );

            if (rows.length > 0) {
                await this.pool.query(
                    `UPDATE backroom_relations
                     SET similarity_score = $3
                     WHERE source_backroom_id = $2 AND related_backroom_id = $1`,
                    [sourceId, relatedId, similarityScore]
                );
            } else {
                await this.pool.query(
                    `INSERT INTO backroom_relations (
                        source_backroom_id,
                        related_backroom_id,
                        similarity_score
                     ) VALUES ($1, $2, $3)
                     ON CONFLICT (source_backroom_id, related_backroom_id)
                     DO UPDATE SET similarity_score = $3`,
                    [sourceId, relatedId, similarityScore]
                );
            }
        }, "createBackroomRelation");
    }

    async markBackroomAsUnclusterable(params: {
        backroomId: UUID;
        topic: string;
        reason: string;
    }): Promise<void> {
        return this.withDatabase(async () => {
            try {
                await this.pool.query(
                    `INSERT INTO unclusterable_backrooms (
                        backroom_id,
                        topic,
                        reason
                     ) VALUES ($1, $2, $3)
                     ON CONFLICT (backroom_id) DO UPDATE
                     SET reason = $3,
                         marked_at = CURRENT_TIMESTAMP`,
                    [params.backroomId, params.topic, params.reason]
                );

                elizaLogger.debug("Marked backroom as unclusterable:", {
                    backroomId: params.backroomId,
                    topic: params.topic,
                    reason: params.reason
                });
            } catch (error) {
                elizaLogger.error("Failed to mark backroom as unclusterable:", {
                    error: error instanceof Error ? error.message : String(error),
                    backroomId: params.backroomId
                });
                throw error;
            }
        }, "markBackroomAsUnclusterable");
    }

    async getUnclusterableBackrooms(topic: string): Promise<BackroomEntry[]> {
        return this.withDatabase(async () => {
            try {
                const { rows } = await this.pool.query(
                    `SELECT b.*
                     FROM backrooms b
                     INNER JOIN unclusterable_backrooms u ON b.id = u.backroom_id
                     WHERE u.topic = $1`,
                    [topic]
                );

                elizaLogger.debug("Retrieved unclusterable backrooms:", {
                    topic,
                    count: rows.length
                });

                return rows.map(row => ({
                    id: row.id,
                    topic: row.topic || '',
                    title: row.title,
                    question: row.question || '',
                    content: typeof row.content === 'string' ? JSON.parse(row.content) : row.content,
                    iqTxHash: row.iq_tx_hash,
                    citations: row.citations || [],
                    tweetUrl: row.tweet_url,
                    upvotes: row.upvotes || 0,
                    created_at: row.created_at,
                    metadata: {
                        technicalTerms: row.technical_terms || [],
                        entities: row.entities || [],
                        claims: row.claims || []
                    }
                }));
            } catch (error) {
                elizaLogger.error("Failed to get unclusterable backrooms:", {
                    error: error instanceof Error ? error.message : String(error),
                    topic
                });
                throw error;
            }
        }, "getUnclusterableBackrooms");
    }

    async removeUnclusterableStatus(backroomId: UUID): Promise<void> {
        return this.withDatabase(async () => {
            try {
                await this.pool.query(
                    `DELETE FROM unclusterable_backrooms
                     WHERE backroom_id = $1`,
                    [backroomId]
                );

                elizaLogger.debug("Removed unclusterable status from backroom:", {
                    backroomId
                });
            } catch (error) {
                elizaLogger.error("Failed to remove unclusterable status:", {
                    error: error instanceof Error ? error.message : String(error),
                    backroomId
                });
                throw error;
            }
        }, "removeUnclusterableStatus");
    }

    async createArticle(data: {
        article: string;
        title: string;
        topic: string;
        iqTxHash: string | null;
        roomId: UUID;
        relatedArticles?: Array<{
            id: number;
            relationType: RelationType;
        }>;
        sourceBackroomIds?: string[];
        parentArticleId?: number;
        updateReason?: string;
        updatedBy?: UUID;
    }): Promise<number> {
        const client = await this.pool.connect();
        
        try {
            await client.query('BEGIN');

            let articleId: number;

            if (data.parentArticleId) {
                const { rows: [parentArticle] } = await client.query(
                    `SELECT current_version FROM articles WHERE id = $1`,
                    [data.parentArticleId]
                );

                if (!parentArticle) {
                    throw new Error(`Parent article ${data.parentArticleId} not found`);
                }

                const { rows: [newArticle] } = await client.query(
                    `INSERT INTO articles (
                        article,
                        title,
                        topic,
                        iq_tx_hash,
                        room_id,
                        current_version
                    ) VALUES ($1, $2, $3, $4, $5, 1)
                    RETURNING id`,
                    [data.article, data.title, data.topic, data.iqTxHash, data.roomId]
                );
                articleId = newArticle.id;

                await client.query(
                    `INSERT INTO article_versions (
                        article_id,
                        article,
                        title,
                        version,
                        updated_by,
                        update_reason,
                        iq_tx_hash,
                        child_article_id
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [
                        data.parentArticleId,
                        data.article,
                        data.title,
                        parentArticle.current_version + 1,
                        data.updatedBy || null,
                        data.updateReason || null,
                        data.iqTxHash,
                        articleId
                    ]
                );

                await client.query(
                    `UPDATE articles
                     SET
                        current_version = current_version + 1,
                        updated_at = CURRENT_TIMESTAMP
                     WHERE id = $1`,
                    [data.parentArticleId]
                );
            } else {
                const { rows: [newArticle] } = await client.query(
                    `INSERT INTO articles (
                        article,
                        title,
                        topic,
                        iq_tx_hash,
                        room_id
                    ) VALUES ($1, $2, $3, $4, $5)
                    RETURNING id`,
                    [data.article, data.title, data.topic, data.iqTxHash, data.roomId]
                );
                articleId = newArticle.id;

                await client.query(
                    `INSERT INTO article_versions (
                        article_id,
                        article,
                        title,
                        version
                    ) VALUES ($1, $2, $3, 1)`,
                    [articleId, data.article, data.title]
                );
            }

            if (data.sourceBackroomIds?.length) {
                elizaLogger.debug("Adding source backrooms", {
                    articleId,
                    backroomIds: data.sourceBackroomIds
                });

                await Promise.all(data.sourceBackroomIds.map(backroomId =>
                    client.query(
                        `INSERT INTO article_sources (
                            article_id,
                            backroom_id
                        ) VALUES ($1, $2)`,
                        [articleId, backroomId]
                    )
                ));
            }

            if (data.relatedArticles?.length) {
                await Promise.all(data.relatedArticles.map(relatedArticle =>
                    client.query(
                        `INSERT INTO article_relations (
                            source_article_id,
                            related_article_id,
                            relation_type
                        ) VALUES ($1, $2, $3)`,
                        [articleId, relatedArticle.id, relatedArticle.relationType]
                    )
                ));
            }

            await client.query('COMMIT');
            return articleId;

        } catch (error) {
            await client.query('ROLLBACK');
            elizaLogger.error("Error creating article", {
                error: error instanceof Error ? error.message : String(error),
                article: data.article,
                title: data.title,
                topic: data.topic,
                parentArticleId: data.parentArticleId
            });
            throw error;
        } finally {
            client.release();
        }
    }

    async getArticleById(id: number): Promise<Article> {
        return this.withDatabase(async () => {
            const { rows } = await this.pool.query(
                `SELECT * FROM articles WHERE id = $1`,
                [id]
            );

            console.log("rows: ", rows[0]);

            const articles: Article[] = rows.map((row) => ({
                ...row,
                article: row.article,
                title: row.title,
                topic: row.topic,
                roomId: row.room_id,
                createdAt: row.created_at,
                iqTxHash: row.iq_tx_hash,
                id: row.id,
                imageUrl: row.image_url,
                version: row.current_version,
            } as Article));

            return articles[0];
        }, "getArticleById");
    }

    async getArticlesByTopic(topic: string): Promise<Article[]> {
        elizaLogger.info("Getting articles by topic", { topic });
        return this.withDatabase(async () => {
            const { rows } = await this.pool.query(
                `SELECT
                    id,
                    article,
                    title,
                    topic,
                    iq_tx_hash,
                    room_id,
                    created_at,
                    current_version
                 FROM articles
                 WHERE topic = $1`,
                [topic]
            );

            elizaLogger.info("Retrieved articles by topic", {
                topic,
                count: rows.length
            });

            if (rows.length === 0) {
                return [];
            }

            const articles: Article[] = rows.map((row) => ({
                id: row.id,
                version: row.current_version,
                article: row.article,
                title: row.title,
                topic: row.topic,
                roomId: row.room_id,
                createdAt: row.created_at,
                iqTxHash: row.iq_tx_hash,
            } as Article));

            return articles;
        }, "getArticlesByTopic");
    }

    async getArticlesByBackroomId(backroomId: number): Promise<
        {
            id: number;
            article: string;
            title: string;
            topic: string;
            roomId: UUID;
        }[]
    > {
        return this.withDatabase(async () => {
            try {
                const { rows } = await this.pool.query(
                    `SELECT
                        id,
                        article,
                        title,
                        topic,
                        room_id
                    FROM articles
                    WHERE backroom_id = $1`,
                    [backroomId]
                );

                elizaLogger.debug("Retrieved articles for backroom:", {
                    backroomId,
                    count: rows.length,
                });

                const articles: Article[] = rows.map((row) => ({
                    ...row,
                    article: typeof row.content === "string" ? JSON.parse(row.content) : row.content,
                    roomId: row.room_id,
                    createdAt: row.created_at,
                    iqTxHash: row.iq_tx_hash,
                    id: row.id,
                    title: row.title,
                    topic: row.topic,
                } as Article));

                return articles;
            } catch (error) {
                elizaLogger.error("Failed to retrieve articles for backroom:", {
                    error:
                        error instanceof Error ? error.message : String(error),
                    backroomId,
                });
                throw error;
            }
        }, "getArticlesByBackroomId");
    }

    async getArticleHistory(articleId: number): Promise<ArticleVersion[]> {
        const { rows } = await this.pool.query(
            `WITH RECURSIVE version_tree AS (
                SELECT *, 1 AS depth
                FROM article_versions
                WHERE article_id = $1
                UNION ALL
                SELECT av.*, vt.depth + 1
                FROM article_versions av
                JOIN version_tree vt ON av.parent_article_id = vt.article_id
            )
            SELECT * FROM version_tree
            ORDER BY depth DESC`,
            [articleId]
        );

        return rows;
    }

    async getArticlesByBackroomIds(backroomIds: string[]): Promise<Article[]> {
        const client = await this.pool.connect();
        try {
            const { rows } = await client.query(`
                SELECT DISTINCT a.*
                FROM articles a
                JOIN article_sources src ON a.id = src.article_id
                WHERE src.backroom_id = ANY($1::uuid[])
            `, [backroomIds]);

            const articles: Article[] = rows.map((row) => ({
                ...row,
                article: typeof row.content === "string" ? JSON.parse(row.content) : row.content,
                roomId: row.room_id,
                createdAt: row.created_at,
                iqTxHash: row.iq_tx_hash,
                id: row.id,
                title: row.title,
                topic: row.topic,
            } as Article));

            return articles;
        } finally {
            client.release();
        }
    }

    async createNewArticleVersion(
        articleId: number,
        data: {
            article: string;
            title: string;
            backroomIds: UUID[];
            iqTxHash?: string;
            childArticleId?: UUID;
        }
    ): Promise<number> {
        const client = await this.pool.connect();
        
        try {
            await client.query('BEGIN');

            const versionResult = await client.query(
                'SELECT current_version FROM articles WHERE id = $1',
                [articleId]
            );
            const newVersion = versionResult.rows[0].current_version + 1;

            const versionInsertResult = await client.query(
                `INSERT INTO article_versions (
                    article_id,
                    article,
                    title,
                    version,
                    iq_tx_hash,
                    child_article_id
                ) VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id`,
                [articleId, data.article, data.title, newVersion, data.iqTxHash, data.childArticleId]
            );
            const versionId = versionInsertResult.rows[0].id;

            await client.query(
                `UPDATE articles
                 SET current_version = $1
                 WHERE id = $2`,
                [newVersion, articleId]
            );

            if (data.backroomIds.length) {
                await Promise.all(data.backroomIds.map(backroomId =>
                    client.query(
                        `INSERT INTO article_sources (
                            article_id,
                            backroom_id
                        ) VALUES ($1, $2)
                        ON CONFLICT DO NOTHING`,
                        [articleId, backroomId]
                    )
                ));
            }

            await client.query('COMMIT');
            return versionId;

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async createArticleRelation(params: {
        sourceArticleId: number;
        relatedArticleId: number;
        relationType: RelationType;
        error?: string;
    }): Promise<number> {
        const { sourceArticleId, relatedArticleId, relationType, error } = params;
        const { rows } = await this.pool.query(
            `INSERT INTO article_relations (
                source_article_id,
                related_article_id,
                relation_type,
                error
             ) VALUES ($1, $2, $3, $4)
             RETURNING id`,
            [sourceArticleId, relatedArticleId, relationType.toString(), error]
        );
        return rows[0].id;
    }

    async getArticleErrorRelations(articleId: number): Promise<Array<{
        id: number;
        source_article_id: number;
        related_article_id: number;
        relation_type: RelationType;
        error: string;
    }>> {
        const { rows } = await this.pool.query(
            `SELECT * FROM article_relations
             WHERE (source_article_id = $1 OR related_article_id = $1)
             AND relation_type = 'error'`,
            [articleId]
        );

        const relations: Array<{
            id: number;
            source_article_id: number;
            related_article_id: number;
            relation_type: RelationType;
            error: string;
        }> = rows.map((row) => ({
            ...row,
            relationType: row.relation_type as RelationType,
            sourceArticleId: row.source_article_id,
            relatedArticleId: row.related_article_id,
            error: row.error,
        }));

        return relations;
    }

    async updateArticleRelation(params: {
        id: number;
        relationType: RelationType;
        error?: string | null;
    }): Promise<void> {
        const { id, relationType, error } = params;
        await this.pool.query(
            `UPDATE article_relations
             SET
                relation_type = $2,
                error = $3
             WHERE id = $1`,
            [id, relationType.toString(), error]
        );
    }

    async getArticleVersions(articleId: number): Promise<ArticleVersion[]> {
        return this.withDatabase(async () => {
            try {
                const { rows } = await this.pool.query(
                    `SELECT *
                     FROM article_versions
                     WHERE article_id = $1
                     ORDER BY version DESC`,
                    [articleId]
                );

                elizaLogger.debug("Retrieved article versions:", {
                    articleId,
                    versionCount: rows.length
                });

                return rows.map(row => ({
                    ...row,
                    articleId: row.article_id,
                    updatedBy: row.updated_by,
                    updateReason: row.update_reason,
                    createdAt: row.created_at
                }));
            } catch (error) {
                elizaLogger.error("Failed to get article versions:", {
                    error: error instanceof Error ? error.message : String(error),
                    articleId
                });
                throw error;
            }
        }, "getArticleVersions");
    }

    async createArticleVersion(version: Omit<ArticleVersion, 'id' | 'createdAt'>, childArticleId: UUID): Promise<number> {
        return this.withDatabase(async () => {
            try {
                const { rows } = await this.pool.query(
                    `INSERT INTO article_versions (
                        article_id,
                        child_article_id,
                        article,
                        title,
                        version,
                        updated_by,
                        update_reason
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                    RETURNING id`,
                    [
                        version.articleId,
                        childArticleId,
                        version.article,
                        version.title,
                        version.version,
                        version.updatedBy,
                        version.updateReason
                    ]
                );

                elizaLogger.debug("Created article version:", {
                    articleId: version.articleId,
                    childArticleId: childArticleId,
                    version: version.version
                });

                return rows[0].id;
            } catch (error) {
                elizaLogger.error("Failed to create article version:", {
                    error: error instanceof Error ? error.message : String(error),
                    articleId: version.articleId
                });
                throw error;
            }
        }, "createArticleVersion");
    }

    async getArticleSources(articleId: number): Promise<ArticleSource[]> {
        return this.withDatabase(async () => {
            try {
                const { rows } = await this.pool.query(
                    `SELECT *
                     FROM article_sources
                     WHERE article_id = $1`,
                    [articleId]
                );

                elizaLogger.debug("Retrieved article sources:", {
                    articleId,
                    sourceCount: rows.length
                });

                return rows.map(row => ({
                    ...row,
                    articleId: row.article_id,
                    backroomId: row.backroom_id,
                    addedAt: row.added_at
                }));
            } catch (error) {
                elizaLogger.error("Failed to get article sources:", {
                    error: error instanceof Error ? error.message : String(error),
                    articleId
                });
                throw error;
            }
        }, "getArticleSources");
    }

    async addArticleSource(source: Omit<ArticleSource, 'id' | 'addedAt'>): Promise<number> {
        return this.withDatabase(async () => {
            try {
                const { rows } = await this.pool.query(
                    `INSERT INTO article_sources (
                        article_id,
                        backroom_id
                    ) VALUES ($1, $2)
                    RETURNING id`,
                    [source.articleId, source.backroomId]
                );

                elizaLogger.debug("Added article source:", {
                    articleId: source.articleId,
                    backroomId: source.backroomId
                });

                return rows[0].id;
            } catch (error) {
                elizaLogger.error("Failed to add article source:", {
                    error: error instanceof Error ? error.message : String(error),
                    articleId: source.articleId
                });
                throw error;
            }
        }, "addArticleSource");
    }

    async addImageToArticle(articleId: number, image: { data: Buffer, mediaType: string, articleTitle: string }): Promise<void> {
        elizaLogger.debug("Adding image to article:", {
            articleId,
            articleTitle: image.articleTitle,
            mediaType: image.mediaType
        });

        return this.withDatabase(async () => {
            try {
                const bucketName = "article-images";
                const projectRef = getEnvVariable("SUPABASE_PROJECT_REF");
                const apiKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
                
                const filename = `${articleId}_${encodeURIComponent(image.articleTitle.toLowerCase())}`;

                const uploadUrl = `https://${projectRef}.supabase.co/storage/v1/object/${bucketName}/${filename}`;
                
                const uploadResponse = await fetch(uploadUrl, {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${apiKey}`,
                        "Content-Type": image.mediaType,
                        "x-upsert": "true"
                    },
                    body: image.data
                });

                if (!uploadResponse.ok) {
                    const error = await uploadResponse.json();
                    elizaLogger.error("Failed to upload image:", {
                        status: uploadResponse.status,
                        error
                    });
                    throw new Error(`Failed to upload image: ${error.message || error.error}`);
                }

                const publicUrl = `https://${projectRef}.supabase.co/storage/v1/object/public/${bucketName}/${filename}`;

                await this.pool.query(
                    `UPDATE articles
                     SET image_url = $2
                     WHERE id = $1`,
                    [articleId, publicUrl]
                );

                elizaLogger.debug("Successfully added image to article:", {
                    articleId,
                    imageUrl: publicUrl
                });

            } catch (error) {
                elizaLogger.error("Error adding image to article:", {
                    error: error instanceof Error ? error.message : String(error),
                    articleId
                });
                throw error;
            }
        }, "addImageToArticle");
    }

    async createCluster(cluster: Omit<ClusterWithBackrooms, 'id' | 'createdAt' | 'updatedAt'>): Promise<UUID> {
        return this.withDatabase(async () => {
            const client = await this.pool.connect();
            try {
                await client.query('BEGIN');

                const { rows: [{ id }] } = await client.query(
                    `INSERT INTO clusters (
                        topic,
                        article_id
                     ) VALUES ($1, $2)
                     RETURNING id`,
                    [cluster.topic, cluster.articleId]
                );

                if (cluster.backrooms?.length) {
                    const values = cluster.backrooms.map((_, i) => `($1, $${i + 2})`).join(',');
                    await client.query(
                        `INSERT INTO cluster_backrooms (
                            cluster_id,
                            backroom_id
                         ) VALUES ${values}`,
                        [id, ...cluster.backrooms.map(b => b.id)]
                    );
                }

                await client.query('COMMIT');

                elizaLogger.debug("Created cluster:", {
                    clusterId: id,
                    topic: cluster.topic,
                    articleId: cluster.articleId,
                    backroomsCount: cluster.backrooms?.length
                });

                return id;
            } catch (error) {
                await client.query('ROLLBACK');
                elizaLogger.error("Failed to create cluster:", {
                    error: error instanceof Error ? error.message : String(error),
                    topic: cluster.topic
                });
                throw error;
            } finally {
                client.release();
            }
        }, "createCluster");
    }

    async getCluster(clusterId: UUID): Promise<ClusterWithBackrooms | null> {
        return this.withDatabase(async () => {
            try {
                const { rows } = await this.pool.query(
                    `SELECT
                        c.*,
                        array_agg(b.*) AS backrooms
                    FROM clusters c
                    LEFT JOIN cluster_backrooms cb ON c.id = cb.cluster_id
                    LEFT JOIN backrooms b ON cb.backroom_id = b.id
                    WHERE c.id = $1
                    GROUP BY c.id`,
                    [clusterId]
                );

                if (rows.length === 0) return null;

                const row = rows[0];
                return {
                    id: row.id,
                    topic: row.topic,
                    articleId: row.article_id,
                    backrooms: row.backrooms[0] ? row.backrooms : [],
                    createdAt: row.created_at,
                    updatedAt: row.updated_at
                };
            } catch (error) {
                elizaLogger.error("Failed to get cluster:", {
                    error: error instanceof Error ? error.message : String(error),
                    clusterId
                });
                throw error;
            }
        }, "getCluster");
    }

    async getClusterByArticleId(articleId: number): Promise<ClusterWithBackrooms | null> {
        return this.withDatabase(async () => {
            try {
                elizaLogger.debug("Fetching cluster for article", { articleId });
                
                const { rows } = await this.pool.query(
                    `WITH cluster_backrooms_data AS (
                        SELECT
                            c.*,
                            json_agg(
                                json_build_object(
                                    'id', b.id,
                                    'topic', b.topic,
                                    'title', b.title,
                                    'question', b.question,
                                    'content', b.content,
                                    'iqTxHash', b.iq_tx_hash,
                                    'citations', b.citations,
                                    'tweetUrl', b.tweet_url,
                                    'metadata', json_build_object(
                                        'technicalTerms', b.technical_terms,
                                        'entities', b.entities,
                                        'claims', b.claims
                                    ),
                                    'created_at', b.created_at,
                                    'upvotes', b.upvotes
                                )
                            ) FILTER (WHERE b.id IS NOT NULL) AS backrooms
                        FROM clusters c
                        LEFT JOIN cluster_backrooms cb ON c.id = cb.cluster_id
                        LEFT JOIN backrooms b ON cb.backroom_id = b.id
                        WHERE c.article_id = $1
                        GROUP BY c.id
                        LIMIT 1
                    )
                    SELECT *,
                        COALESCE(backrooms, '[]'::json) AS backrooms
                    FROM cluster_backrooms_data`,
                    [articleId]
                );

                if (rows.length === 0) return null;

                const row = rows[0];

                elizaLogger.debug("Retrieved cluster data", {
                    articleId,
                    foundClusters: rows.length,
                    backroomsCount: row.backrooms?.length || 0,
                    firstBackroomId: row.backrooms?.[0]?.id || null
                });

                return {
                    id: row.id,
                    topic: row.topic,
                    articleId: row.article_id,
                    backrooms: row.backrooms || [],
                    createdAt: row.created_at,
                    updatedAt: row.updated_at
                };
            } catch (error) {
                elizaLogger.error("Failed to get cluster for article:", {
                    error: error instanceof Error ? error.message : String(error),
                    articleId
                });
                throw error;
            }
        }, "getClusterByArticleId");
    }

    async getTopics(): Promise<string[]> {
        return this.withDatabase(async () => {
            const { rows } = await this.pool.query(
                `SELECT DISTINCT topic FROM backrooms`
            );
            return rows.map((row) => row.topic);
        }, "getTopics");
    }

    async createFirecrawlArticleEntry(params: {
        url: string;
        title: string;
        description: string;
        content: string;
    }): Promise<string> {
        return this.withDatabase(async () => {
            try {
                const { rows } = await this.pool.query(
                    `INSERT INTO firecrawl_articles (
                        url,
                        title,
                        description,
                        content
                    ) VALUES ($1, $2, $3, $4)
                    ON CONFLICT (url) DO UPDATE
                    SET
                        title = $2,
                        description = $3,
                        content = $4
                    RETURNING id`,
                    [params.url, params.title, params.description, params.content]
                );

                elizaLogger.debug("Article content created/updated:", {
                    url: params.url,
                    title: params.title,
                    id: rows[0].id
                });

                return rows[0].id;
            } catch (error) {
                elizaLogger.error("Failed to create/update article content:", {
                    error: error instanceof Error ? error.message : String(error),
                    url: params.url
                });
                throw error;
            }
        }, "createFirecrawlArticleEntry");
    }

    async createInvestigationEntry(params: {
        conversationId: string;
        respondedToTweetUrl: string;
        twitterUser: string;
        backroomId: UUID;
        scrappedArticleContent: ScrappedArticle | null;
        sources: string[];
    }): Promise<UUID> {
        elizaLogger.info("Creating investigation entry");
        return this.withDatabase(async () => {
            try {
                let articleContentId: string | null = null;
                if (params.scrappedArticleContent) {
                    articleContentId = await this.createFirecrawlArticleEntry({
                        url: params.scrappedArticleContent.url,
                        title: params.scrappedArticleContent.title,
                        description: params.scrappedArticleContent.description,
                        content: params.scrappedArticleContent.content
                    });
                }

                const { rows } = await this.pool.query(
                    `INSERT INTO investigations (
                        conversation_id,
                        responded_to_tweet_url,
                        twitter_user,
                        backroom_id,
                        firecrawl_articles_id,
                        sources
                    ) VALUES ($1, $2, $3, $4, $5, $6)
                    RETURNING id`,
                    [
                        params.conversationId,
                        params.respondedToTweetUrl,
                        params.twitterUser,
                        params.backroomId,
                        articleContentId,
                        params.sources
                    ]
                );

                elizaLogger.debug("Investigation entry created:", {
                    conversationId: params.conversationId,
                    backroomId: params.backroomId,
                    hasArticle: !!params.scrappedArticleContent,
                    investigationId: rows[0].id
                });

                return rows[0].id;
            } catch (error) {
                elizaLogger.error("Failed to create investigation entry:", {
                    error: error instanceof Error ? error.message : String(error),
                    conversationId: params.conversationId
                });
                throw error;
            }
        }, "createInvestigationEntry");
    }

    async addTweetToInvestigation(params: {
        investigationId: UUID;
        tweetUrl: string;
        tweetResponse: string;
    }): Promise<void> {
        return this.withDatabase(async () => {
            await this.pool.query(
                `UPDATE investigations
                 SET
                    tweet_url = $2,
                    tweet_response = $3
                 WHERE id = $1`,
                [params.investigationId, params.tweetUrl, params.tweetResponse]
            );
        }, "addTweetToInvestigation");
    }

    async getKnowledge(params: {
        id?: UUID;
        agentId: UUID;
        limit?: number;
        query?: string;
    }): Promise<RAGKnowledgeItem[]> {
        return this.withDatabase(async () => {
            let sql = `SELECT *
                       FROM knowledge
                       WHERE ("agentId" = $1 OR "isShared" = true)`;
            const queryParams: any[] = [params.agentId];
            let paramCount = 1;

            if (params.id) {
                paramCount++;
                sql += ` AND id = $${paramCount}`;
                queryParams.push(params.id);
            }

            if (params.limit) {
                paramCount++;
                sql += ` LIMIT $${paramCount}`;
                queryParams.push(params.limit);
            }

            const { rows } = await this.pool.query(sql, queryParams);

            return rows.map((row) => ({
                id: row.id,
                agentId: row.agentId,
                content:
                    typeof row.content === "string"
                        ? JSON.parse(row.content)
                        : row.content,
                embedding: row.embedding
                    ? new Float32Array(row.embedding)
                    : undefined,
                createdAt: row.createdAt.getTime(),
            }));
        }, "getKnowledge");
    }

    async searchKnowledge(params: {
        agentId: UUID;
        embedding: Float32Array;
        match_threshold: number;
        match_count: number;
        searchText?: string;
    }): Promise<RAGKnowledgeItem[]> {
        return this.withDatabase(async () => {
            const cacheKey = `embedding_${params.agentId}_${params.searchText}`;
            const cachedResult = await this.getCache({
                key: cacheKey,
                agentId: params.agentId,
            });

            if (cachedResult) {
                return JSON.parse(cachedResult);
            }

            const vectorStr = `[${Array.from(params.embedding).join(",")}]`;

            const sql = `
                WITH vector_scores AS (
                    SELECT
                        id,
                        1 - (embedding <-> $1::vector) AS vector_score
                    FROM knowledge
                    WHERE ("agentId" IS NULL AND "isShared" = true) OR "agentId" = $2
                    AND embedding IS NOT NULL
                ),
                keyword_matches AS (
                    SELECT
                        id,
                        CASE
                            WHEN content->>'text' ILIKE $3 THEN 3.0
                            ELSE 1.0
                        END *
                        CASE
                            WHEN (content->'metadata'->>'isChunk')::boolean = true THEN 1.5
                            WHEN (content->'metadata'->>'isMain')::boolean = true THEN 1.2
                            ELSE 1.0
                        END AS keyword_score
                    FROM knowledge
                    WHERE ("agentId" IS NULL AND "isShared" = true) OR "agentId" = $2
                )
                SELECT
                    k.*,
                    v.vector_score,
                    kw.keyword_score,
                    (v.vector_score * kw.keyword_score) AS combined_score
                FROM knowledge k
                JOIN vector_scores v ON k.id = v.id
                LEFT JOIN keyword_matches kw ON k.id = kw.id
                WHERE ("agentId" IS NULL AND "isShared" = true) OR k."agentId" = $2
                AND (
                    v.vector_score >= $4
                    OR (kw.keyword_score > 1.0 AND v.vector_score >= 0.3)
                )
                ORDER BY combined_score DESC
                LIMIT $5
            `;

            const { rows } = await this.pool.query(sql, [
                vectorStr,
                params.agentId,
                `%${params.searchText || ""}%`,
                params.match_threshold,
                params.match_count,
            ]);

            const results = rows.map((row) => ({
                id: row.id,
                agentId: row.agentId,
                content:
                    typeof row.content === "string"
                        ? JSON.parse(row.content)
                        : row.content,
                embedding: row.embedding
                    ? new Float32Array(row.embedding)
                    : undefined,
                createdAt: row.createdAt.getTime(),
                similarity: row.combined_score,
            }));

            await this.setCache({
                key: cacheKey,
                agentId: params.agentId,
                value: JSON.stringify(results),
            });

            return results;
        }, "searchKnowledge");
    }

    async createKnowledge(knowledge: RAGKnowledgeItem): Promise<void> {
        return this.withDatabase(async () => {
            const client = await this.pool.connect();
            try {
                await client.query("BEGIN");

                const metadata = knowledge.content.metadata || {};
                const vectorStr = knowledge.embedding
                    ? `[${Array.from(knowledge.embedding).join(",")}]`
                    : null;

                if (metadata.isChunk && metadata.originalId) {
                    await this.createKnowledgeChunk({
                        id: knowledge.id,
                        originalId: metadata.originalId,
                        agentId: metadata.isShared ? null : knowledge.agentId,
                        content: knowledge.content,
                        embedding: knowledge.embedding,
                        chunkIndex: metadata.chunkIndex || 0,
                        isShared: metadata.isShared || false,
                        createdAt: knowledge.createdAt || Date.now(),
                    });
                } else {
                    await client.query(
                        `
                        INSERT INTO knowledge (
                            id,
                            "agentId",
                            content,
                            embedding,
                            "createdAt",
                            "isMain",
                            "originalId",
                            "chunkIndex",
                            "isShared"
                        ) VALUES ($1, $2, $3, $4, to_timestamp($5/1000.0), $6, $7, $8, $9)
                        ON CONFLICT (id) DO NOTHING
                    `,
                        [
                            knowledge.id,
                            metadata.isShared ? null : knowledge.agentId,
                            knowledge.content,
                            vectorStr,
                            knowledge.createdAt || Date.now(),
                            true,
                            null,
                            null,
                            metadata.isShared || false,
                        ]
                    );
                }

                await client.query("COMMIT");
            } catch (error) {
                await client.query("ROLLBACK");
                throw error;
            } finally {
                client.release();
            }
        }, "createKnowledge");
    }

    async removeKnowledge(id: UUID): Promise<void> {
        return this.withDatabase(async () => {
            const client = await this.pool.connect();
            try {
                await client.query("BEGIN");

                if (typeof id === "string" && id.includes("-chunk-*")) {
                    const mainId = id.split("-chunk-")[0];
                    await client.query(
                        `DELETE FROM knowledge WHERE "originalId" = $1`,
                        [mainId]
                    );
                } else {
                    await client.query(
                        `DELETE FROM knowledge WHERE "originalId" = $1`,
                        [id]
                    );
                    await client.query(
                        "DELETE FROM knowledge WHERE id = $1",
                        [id]
                    );
                }

                await client.query("COMMIT");
            } catch (error) {
                await client.query("ROLLBACK");
                elizaLogger.error("Error removing knowledge", {
                    error:
                        error instanceof Error ? error.message : String(error),
                    id,
                });
                throw error;
            } finally {
                client.release();
            }
        }, "removeKnowledge");
    }

    async clearKnowledge(agentId: UUID, shared?: boolean): Promise<void> {
        return this.withDatabase(async () => {
            const sql = shared
                ? `DELETE FROM knowledge WHERE ("agentId" = $1 OR "isShared" = true)`
                : `DELETE FROM knowledge WHERE "agentId" = $1`;

            await this.pool.query(sql, [agentId]);
        }, "clearKnowledge");
    }

    private async createKnowledgeChunk(params: {
        id: UUID;
        originalId: UUID;
        agentId: UUID | null;
        content: any;
        embedding: Float32Array | undefined | null;
        chunkIndex: number;
        isShared: boolean;
        createdAt: number;
    }): Promise<void> {
        const vectorStr = params.embedding
            ? `[${Array.from(params.embedding).join(",")}]`
            : null;

        const patternId = `${params.originalId}-chunk-${params.chunkIndex}`;
        const contentWithPatternId = {
            ...params.content,
            metadata: {
                ...params.content.metadata,
                patternId,
            },
        };

        await this.pool.query(
            `
            INSERT INTO knowledge (
                id,
                "agentId",
                content,
                embedding,
                "createdAt",
                "isMain",
                "originalId",
                "chunkIndex",
                "isShared"
            ) VALUES ($1, $2, $3, $4, to_timestamp($5/1000.0), $6, $7, $8, $9)
            ON CONFLICT (id) DO NOTHING
        `,
            [
                v4(),
                params.agentId,
                contentWithPatternId,
                vectorStr,
                params.createdAt,
                false,
                params.originalId,
                params.chunkIndex,
                params.isShared,
            ]
        );
    }
}

export default PostgresDatabaseAdapter;

export {
    BackroomEntry,
    ConversationMessage,
    RelationType,
    ScrappedArticle,
    ArticleVersion,
    Article,
    ArticleSource,
    ClusterWithBackrooms,
    ArticleRelation,
    UnclusterableBackroom,
}