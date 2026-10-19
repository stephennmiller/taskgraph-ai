/**
 * Unit tests for indicators module (priority and complexity indicators)
 */
import { vi } from 'vitest';

// Mock chalk using unstable_mockModule for ESM compatibility
vi.doMock('chalk', () => ({
	// Callable like the real chalk: the theme uses chalk, chalk.cyan(.bold) and chalk.magenta
	default: Object.assign(
		vi.fn((str) => str),
		{
			red: vi.fn((str) => str),
			yellow: vi.fn((str) => str),
			green: vi.fn((str) => str),
			dim: vi.fn((str) => str),
			white: vi.fn((str) => str),
			cyan: Object.assign(
				vi.fn((str) => str),
				{ bold: vi.fn((str) => str) }
			),
			magenta: vi.fn((str) => str),
			hex: vi.fn(() => vi.fn((str) => str))
		}
	)
}));

// Import after mocking
const {
	getMcpPriorityIndicators,
	getCliPriorityIndicators,
	getPriorityIndicators,
	getPriorityIndicator,
	getStatusBarPriorityIndicators,
	getPriorityColors,
	getCliComplexityIndicators,
	getStatusBarComplexityIndicators,
	getComplexityColors,
	getComplexityIndicator
} = await import('../../../src/ui/indicators.js');

describe('Priority Indicators', () => {
	describe('getMcpPriorityIndicators', () => {
		it('should return emoji indicators for MCP context', () => {
			const indicators = getMcpPriorityIndicators();
			expect(indicators).toEqual({
				high: '🔴',
				medium: '🟠',
				low: '🟢'
			});
		});
	});

	describe('getCliPriorityIndicators', () => {
		it('should return colored dot indicators for CLI context', () => {
			const indicators = getCliPriorityIndicators();
			expect(indicators).toHaveProperty('high');
			expect(indicators).toHaveProperty('medium');
			expect(indicators).toHaveProperty('low');
			// Since chalk is mocked, we're just verifying structure
			expect(indicators.high).toContain('●');
		});
	});

	describe('getPriorityIndicators', () => {
		it('should return MCP indicators when isMcp is true', () => {
			const indicators = getPriorityIndicators(true);
			expect(indicators).toEqual({
				high: '🔴',
				medium: '🟠',
				low: '🟢'
			});
		});

		it('should return CLI indicators when isMcp is false', () => {
			const indicators = getPriorityIndicators(false);
			expect(indicators).toHaveProperty('high');
			expect(indicators).toHaveProperty('medium');
			expect(indicators).toHaveProperty('low');
		});

		it('should default to CLI indicators when no parameter provided', () => {
			const indicators = getPriorityIndicators();
			expect(indicators).toHaveProperty('high');
			expect(indicators.high).toContain('●');
		});
	});

	describe('getPriorityIndicator', () => {
		it('should return correct MCP indicator for valid priority', () => {
			expect(getPriorityIndicator('high', true)).toBe('🔴');
			expect(getPriorityIndicator('medium', true)).toBe('🟠');
			expect(getPriorityIndicator('low', true)).toBe('🟢');
		});

		it('should return correct CLI indicator for valid priority', () => {
			const highIndicator = getPriorityIndicator('high', false);
			const mediumIndicator = getPriorityIndicator('medium', false);
			const lowIndicator = getPriorityIndicator('low', false);

			expect(highIndicator).toContain('●');
			expect(mediumIndicator).toContain('●');
			expect(lowIndicator).toContain('●');
		});

		it('should return medium indicator for invalid priority', () => {
			expect(getPriorityIndicator('invalid', true)).toBe('🟠');
			expect(getPriorityIndicator(null, true)).toBe('🟠');
			expect(getPriorityIndicator(undefined, true)).toBe('🟠');
		});

		it('should default to CLI context when isMcp not provided', () => {
			const indicator = getPriorityIndicator('high');
			expect(indicator).toContain('●');
		});
	});
});

describe('Complexity Indicators', () => {
	describe('getCliComplexityIndicators', () => {
		it('should return colored dot indicators for complexity levels', () => {
			const indicators = getCliComplexityIndicators();
			expect(indicators).toHaveProperty('high');
			expect(indicators).toHaveProperty('medium');
			expect(indicators).toHaveProperty('low');
			expect(indicators.high).toContain('●');
		});
	});

	describe('getStatusBarComplexityIndicators', () => {
		it('should return single character indicators for status bars', () => {
			const indicators = getStatusBarComplexityIndicators();
			// Since chalk is mocked, we need to check for the actual characters
			expect(indicators.high).toContain('⋮');
			expect(indicators.medium).toContain(':');
			expect(indicators.low).toContain('.');
		});
	});

	describe('getComplexityColors', () => {
		it('should return complexity color functions', () => {
			const colors = getComplexityColors();
			expect(colors).toHaveProperty('high');
			expect(colors).toHaveProperty('medium');
			expect(colors).toHaveProperty('low');
			// Verify they are functions (mocked chalk functions)
			expect(typeof colors.high).toBe('function');
		});
	});

	describe('getComplexityIndicator', () => {
		it('should return high indicator for scores >= 7', () => {
			const cliIndicators = getCliComplexityIndicators();
			expect(getComplexityIndicator(7)).toBe(cliIndicators.high);
			expect(getComplexityIndicator(8)).toBe(cliIndicators.high);
			expect(getComplexityIndicator(10)).toBe(cliIndicators.high);
		});

		it('should return low indicator for scores <= 3', () => {
			const cliIndicators = getCliComplexityIndicators();
			expect(getComplexityIndicator(1)).toBe(cliIndicators.low);
			expect(getComplexityIndicator(2)).toBe(cliIndicators.low);
			expect(getComplexityIndicator(3)).toBe(cliIndicators.low);
		});

		it('should return medium indicator for scores 4-6', () => {
			const cliIndicators = getCliComplexityIndicators();
			expect(getComplexityIndicator(4)).toBe(cliIndicators.medium);
			expect(getComplexityIndicator(5)).toBe(cliIndicators.medium);
			expect(getComplexityIndicator(6)).toBe(cliIndicators.medium);
		});

		it('should return status bar indicators when statusBar is true', () => {
			const statusBarIndicators = getStatusBarComplexityIndicators();
			expect(getComplexityIndicator(8, true)).toBe(statusBarIndicators.high);
			expect(getComplexityIndicator(5, true)).toBe(statusBarIndicators.medium);
			expect(getComplexityIndicator(2, true)).toBe(statusBarIndicators.low);
		});
	});
});
