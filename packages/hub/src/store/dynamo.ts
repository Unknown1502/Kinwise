import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { HouseholdState } from '../domain/types.js';
import { ConflictError, type Store } from './store.js';

/**
 * One item per household: { pk, version, state (JSON string) }. Storing the
 * aggregate as a string keeps reads to a single GetItem (fast enough for the
 * Alexa+ 500 ms budget) and avoids DynamoDB empty-value edge cases.
 */
export class DynamoStore implements Store {
  private readonly doc: DynamoDBDocumentClient;

  constructor(
    private readonly tableName: string,
    client = new DynamoDBClient({}),
  ) {
    this.doc = DynamoDBDocumentClient.from(client);
  }

  async load(householdId: string): Promise<HouseholdState | undefined> {
    const out = await this.doc.send(
      new GetCommand({ TableName: this.tableName, Key: { pk: householdId }, ConsistentRead: true }),
    );
    const raw = out.Item?.state;
    return typeof raw === 'string' ? (JSON.parse(raw) as HouseholdState) : undefined;
  }

  async save(state: HouseholdState, expectedVersion: number): Promise<void> {
    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            pk: state.household.id,
            version: state.version,
            state: JSON.stringify(state),
            updatedAt: new Date().toISOString(),
          },
          ConditionExpression:
            expectedVersion === 0 ? 'attribute_not_exists(pk)' : '#v = :expected',
          ...(expectedVersion === 0
            ? {}
            : { ExpressionAttributeNames: { '#v': 'version' }, ExpressionAttributeValues: { ':expected': expectedVersion } }),
        }),
      );
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) throw new ConflictError(state.household.id);
      throw err;
    }
  }
}
