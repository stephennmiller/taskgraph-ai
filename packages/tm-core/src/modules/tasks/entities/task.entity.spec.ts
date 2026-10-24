/**
 * @fileoverview Unit tests for TaskEntity metadata handling
 *
 * Tests the preservation of user-defined metadata through all TaskEntity operations
 * including construction, serialization, and deserialization.
 */

import { describe, expect, it } from 'vitest';
import { TaskEntity } from './task.entity.js';
import type { Task } from '../../../common/types/index.js';

/**
 * Creates a minimal valid task for testing
 */
function createMinimalTask(overrides: Partial<Task> = {}): Task {
	return {
		id: '1',
		title: 'Test Task',
		description: 'Test description',
		status: 'pending',
		priority: 'medium',
		dependencies: [],
		details: 'Task details',
		testStrategy: 'Test strategy',
		subtasks: [],
		...overrides
	};
}

describe('TaskEntity', () => {
	describe('description', () => {
		it.each([
			['empty', ''],
			['blank', '   '],
			['missing', undefined]
		])('takes the title when the description is %s', (_, description) => {
			const task = createMinimalTask({
				title: 'Add health check',
				description: description as string
			});

			const entity = new TaskEntity(task);

			expect(entity.description).toBe('Add health check');
		});

		it('keeps a description that has text', () => {
			const entity = new TaskEntity(createMinimalTask());

			expect(entity.description).toBe('Test description');
		});

		it('still rejects a task with no title', () => {
			const task = createMinimalTask({ title: '', description: '' });

			expect(() => new TaskEntity(task)).toThrow('Task title is required');
		});
	});

	describe('toJSON() fields the entity does not model', () => {
		it('keeps acceptanceCriteria and definitionOfDoneChecked (#369)', () => {
			const task = createMinimalTask({
				acceptanceCriteria: ['Migrations run', { text: 'Docs', checked: true }],
				definitionOfDoneChecked: ['Tests pass']
			});

			const json = new TaskEntity(task).toJSON();

			expect(json.acceptanceCriteria).toEqual(task.acceptanceCriteria);
			expect(json.definitionOfDoneChecked).toEqual(['Tests pass']);
		});

		it('copies a __proto__ key from tasks.json as plain data', () => {
			const task = JSON.parse(
				JSON.stringify(createMinimalTask()).replace(
					'{',
					'{"__proto__":{"polluted":true},'
				)
			);

			const json = new TaskEntity(task).toJSON();

			expect(Object.getPrototypeOf(json)).toBe(Object.prototype);
			expect((json as { polluted?: boolean }).polluted).toBeUndefined();
		});

		it('still prints the normalized and updated values', () => {
			const entity = new TaskEntity({
				...createMinimalTask(),
				id: 7,
				dependencies: [3 as unknown as string]
			});
			entity.updateStatus('in-progress');

			const json = entity.toJSON();

			expect(json.id).toBe('7');
			expect(json.dependencies).toEqual(['3']);
			expect(json.status).toBe('in-progress');
		});
	});

	describe('metadata property', () => {
		it('should preserve metadata through constructor', () => {
			const metadata = { uuid: '123', custom: 'value' };
			const task = createMinimalTask({ metadata });

			const entity = new TaskEntity(task);

			expect(entity.metadata).toEqual(metadata);
		});

		it('should handle undefined metadata', () => {
			const task = createMinimalTask();
			// Explicitly not setting metadata

			const entity = new TaskEntity(task);

			expect(entity.metadata).toBeUndefined();
		});

		it('should handle empty metadata object', () => {
			const task = createMinimalTask({ metadata: {} });

			const entity = new TaskEntity(task);

			expect(entity.metadata).toEqual({});
		});

		it('should preserve metadata with string values', () => {
			const metadata = { externalId: 'EXT-123', source: 'jira' };
			const task = createMinimalTask({ metadata });

			const entity = new TaskEntity(task);

			expect(entity.metadata).toEqual(metadata);
		});

		it('should preserve metadata with number values', () => {
			const metadata = { priority: 5, score: 100 };
			const task = createMinimalTask({ metadata });

			const entity = new TaskEntity(task);

			expect(entity.metadata).toEqual(metadata);
		});

		it('should preserve metadata with boolean values', () => {
			const metadata = { isBlocking: true, reviewed: false };
			const task = createMinimalTask({ metadata });

			const entity = new TaskEntity(task);

			expect(entity.metadata).toEqual(metadata);
		});

		it('should preserve metadata with nested objects', () => {
			const metadata = {
				jira: {
					key: 'PROJ-123',
					sprint: {
						id: 5,
						name: 'Sprint 5'
					}
				}
			};
			const task = createMinimalTask({ metadata });

			const entity = new TaskEntity(task);

			expect(entity.metadata).toEqual(metadata);
		});

		it('should preserve metadata with arrays', () => {
			const metadata = {
				labels: ['bug', 'high-priority'],
				relatedIds: [1, 2, 3]
			};
			const task = createMinimalTask({ metadata });

			const entity = new TaskEntity(task);

			expect(entity.metadata).toEqual(metadata);
		});

		it('should preserve metadata with null values', () => {
			const metadata = { deletedAt: null, archivedBy: null };
			const task = createMinimalTask({ metadata });

			const entity = new TaskEntity(task);

			expect(entity.metadata).toEqual(metadata);
		});

		it('should preserve complex mixed metadata', () => {
			const metadata = {
				externalId: 'EXT-456',
				score: 85,
				isUrgent: true,
				tags: ['frontend', 'refactor'],
				integration: {
					source: 'github',
					issueNumber: 123,
					labels: ['enhancement']
				},
				timestamps: {
					importedAt: '2024-01-15T10:00:00Z',
					lastSynced: null
				}
			};
			const task = createMinimalTask({ metadata });

			const entity = new TaskEntity(task);

			expect(entity.metadata).toEqual(metadata);
		});
	});

	describe('toJSON() with metadata', () => {
		it('should include metadata in toJSON output', () => {
			const metadata = { uuid: '123', custom: 'value' };
			const task = createMinimalTask({ metadata });
			const entity = new TaskEntity(task);

			const json = entity.toJSON();

			expect(json.metadata).toEqual(metadata);
		});

		it('should include undefined metadata in toJSON output', () => {
			const task = createMinimalTask();
			const entity = new TaskEntity(task);

			const json = entity.toJSON();

			expect(json.metadata).toBeUndefined();
		});

		it('should include empty metadata object in toJSON output', () => {
			const task = createMinimalTask({ metadata: {} });
			const entity = new TaskEntity(task);

			const json = entity.toJSON();

			expect(json.metadata).toEqual({});
		});

		it('should preserve nested metadata through toJSON', () => {
			const metadata = {
				integration: {
					source: 'linear',
					config: {
						apiKey: 'redacted',
						projectId: 'proj_123'
					}
				}
			};
			const task = createMinimalTask({ metadata });
			const entity = new TaskEntity(task);

			const json = entity.toJSON();

			expect(json.metadata).toEqual(metadata);
		});
	});

	describe('round-trip preservation', () => {
		it('should preserve metadata through full round-trip', () => {
			const originalMetadata = {
				uuid: '550e8400-e29b-41d4-a716-446655440000',
				externalSystem: 'jira',
				customField: { nested: 'value' }
			};
			const originalTask = createMinimalTask({ metadata: originalMetadata });

			// Task -> TaskEntity -> toJSON() -> TaskEntity -> toJSON()
			const entity1 = new TaskEntity(originalTask);
			const json1 = entity1.toJSON();
			const entity2 = new TaskEntity(json1);
			const json2 = entity2.toJSON();

			expect(json2.metadata).toEqual(originalMetadata);
		});

		it('should preserve all task fields alongside metadata', () => {
			const metadata = { custom: 'data' };
			const task = createMinimalTask({
				id: '42',
				title: 'Important Task',
				description: 'Do the thing',
				status: 'in-progress',
				priority: 'high',
				dependencies: ['1', '2'],
				details: 'Detailed info',
				testStrategy: 'Unit tests',
				tags: ['urgent'],
				metadata
			});

			const entity = new TaskEntity(task);
			const json = entity.toJSON();

			expect(json.id).toBe('42');
			expect(json.title).toBe('Important Task');
			expect(json.description).toBe('Do the thing');
			expect(json.status).toBe('in-progress');
			expect(json.priority).toBe('high');
			expect(json.dependencies).toEqual(['1', '2']);
			expect(json.details).toBe('Detailed info');
			expect(json.testStrategy).toBe('Unit tests');
			expect(json.tags).toEqual(['urgent']);
			expect(json.metadata).toEqual(metadata);
		});
	});

	describe('fromObject() with metadata', () => {
		it('should preserve metadata through fromObject', () => {
			const metadata = { externalId: 'EXT-789' };
			const task = createMinimalTask({ metadata });

			const entity = TaskEntity.fromObject(task);

			expect(entity.metadata).toEqual(metadata);
		});

		it('should handle undefined metadata in fromObject', () => {
			const task = createMinimalTask();

			const entity = TaskEntity.fromObject(task);

			expect(entity.metadata).toBeUndefined();
		});
	});

	describe('fromArray() with metadata', () => {
		it('should preserve metadata on all tasks through fromArray', () => {
			const task1 = createMinimalTask({
				id: '1',
				metadata: { source: 'import1' }
			});
			const task2 = createMinimalTask({
				id: '2',
				metadata: { source: 'import2' }
			});
			const task3 = createMinimalTask({ id: '3' }); // No metadata

			const entities = TaskEntity.fromArray([task1, task2, task3]);

			expect(entities).toHaveLength(3);
			expect(entities[0].metadata).toEqual({ source: 'import1' });
			expect(entities[1].metadata).toEqual({ source: 'import2' });
			expect(entities[2].metadata).toBeUndefined();
		});

		it('should preserve different metadata structures across tasks', () => {
			const tasks = [
				createMinimalTask({ id: '1', metadata: { simple: 'value' } }),
				createMinimalTask({
					id: '2',
					metadata: { nested: { deep: { value: 123 } } }
				}),
				createMinimalTask({ id: '3', metadata: { array: [1, 2, 3] } }),
				createMinimalTask({ id: '4', metadata: {} })
			];

			const entities = TaskEntity.fromArray(tasks);
			const jsons = entities.map((e) => e.toJSON());

			expect(jsons[0].metadata).toEqual({ simple: 'value' });
			expect(jsons[1].metadata).toEqual({ nested: { deep: { value: 123 } } });
			expect(jsons[2].metadata).toEqual({ array: [1, 2, 3] });
			expect(jsons[3].metadata).toEqual({});
		});
	});

	describe('no corruption of other fields', () => {
		it('should not affect other task fields when metadata is present', () => {
			const taskWithMetadata = createMinimalTask({
				id: '99',
				title: 'Original Title',
				metadata: { someKey: 'someValue' }
			});

			const entity = new TaskEntity(taskWithMetadata);

			expect(entity.id).toBe('99');
			expect(entity.title).toBe('Original Title');
			expect(entity.status).toBe('pending');
			expect(entity.priority).toBe('medium');
		});

		it('should not affect subtasks when metadata is present', () => {
			const taskWithSubtasks = createMinimalTask({
				metadata: { tracked: true },
				subtasks: [
					{
						id: 1,
						parentId: '1',
						title: 'Subtask 1',
						description: 'Subtask desc',
						status: 'pending',
						priority: 'low',
						dependencies: [],
						details: '',
						testStrategy: ''
					}
				]
			});

			const entity = new TaskEntity(taskWithSubtasks);

			expect(entity.subtasks).toHaveLength(1);
			expect(entity.subtasks[0].title).toBe('Subtask 1');
			expect(entity.metadata).toEqual({ tracked: true });
		});
	});

	describe('subtask ids', () => {
		// Regression: #310, a subtask stored without parentId read as "undefined"
		it("gives a subtask stored without parentId its task's id", () => {
			const entity = new TaskEntity(
				createMinimalTask({
					id: '2',
					subtasks: [
						{
							id: 1,
							title: 'Schema',
							description: 'Write the schema',
							status: 'pending',
							dependencies: []
						} as unknown as Task['subtasks'][number]
					]
				})
			);

			expect(entity.subtasks[0].id).toBe('1');
			expect(entity.subtasks[0].parentId).toBe('2');
		});

		it('keeps a stored parentId', () => {
			const entity = new TaskEntity(
				createMinimalTask({
					id: '2',
					subtasks: [
						{
							id: 1,
							parentId: '2',
							title: 'Schema',
							description: 'Write the schema',
							status: 'pending',
							priority: 'low',
							dependencies: [],
							details: '',
							testStrategy: ''
						}
					]
				})
			);

			expect(entity.subtasks[0].parentId).toBe('2');
		});
	});
});
