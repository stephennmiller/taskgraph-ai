/**
 * Estimate the tokens in a text string. A rough approximation of about 4
 * characters per token for English, used where an exact tokenizer isn't worth
 * shipping.
 * @param {string} text - Text to estimate tokens for
 * @returns {number} Estimated token count, 0 for empty or non-string input
 */
export function estimateTokens(text) {
	if (!text || typeof text !== 'string') {
		return 0;
	}
	return Math.ceil(text.length / 4);
}
