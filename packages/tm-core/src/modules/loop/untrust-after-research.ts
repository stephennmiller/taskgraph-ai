/**
 * @fileoverview Loop asks again before saving what the research role wrote.
 */

import type { AiServiceResult } from '../ai/ai-service.js';
import { untrustLoop } from './loop-trust.js';

/**
 * Withdraw loop approval when the research role answered, asked for or
 * reached as a fallback: its reply can quote web pages the user who
 * approved loop never read. Call it before saving the reply.
 */
export function untrustLoopIfResearch(
	response: Pick<AiServiceResult, 'role'>,
	projectRoot: string
): void {
	if (response.role === 'research') untrustLoop(projectRoot);
}
