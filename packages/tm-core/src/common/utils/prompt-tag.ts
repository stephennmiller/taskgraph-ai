/**
 * Text going between `<tag>` and `</tag>` in a prompt can't open or close
 * that tag, so outside text reads as data, not as part of the prompt
 */
export function neutralizeTag(text: string, tag: string): string {
	// One character class keeps this linear on long whitespace runs, and the
	// `-` stops a `<` or `</` just before the match joining the tag name
	// (`</</tag>` must not become `</tag>`)
	return text.replace(new RegExp(`<[\\s/]*${tag}`, 'gi'), `-${tag}`);
}
