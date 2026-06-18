import { describe, expect, it } from 'vitest';
import { buildInlineFileMarker, parseInlineFileMarker } from '../../../shared/file-markers';

describe('file markers', () => {
    it('builds markers for full files and ranges', () => {
        expect(buildInlineFileMarker({
            relativePath: 'src/foo.ts',
            absolutePath: '/workspace/src/foo.ts',
        } as any)).toBe('[[file:/workspace/src/foo.ts]]');

        expect(buildInlineFileMarker({
            relativePath: 'src/foo.ts',
            absolutePath: '/workspace/src/foo.ts',
            startLine: 10,
            endLine: 12,
        } as any)).toBe('[[file:/workspace/src/foo.ts:10-12]]');
    });

    it('parses markers for full files and ranges', () => {
        expect(parseInlineFileMarker('[[file:/workspace/src/foo.ts]]')).toEqual({
            raw: '[[file:/workspace/src/foo.ts]]',
            path: '/workspace/src/foo.ts',
        });

        expect(parseInlineFileMarker('[[file:/workspace/src/foo.ts:10-12]]')).toEqual({
            raw: '[[file:/workspace/src/foo.ts:10-12]]',
            path: '/workspace/src/foo.ts',
            startLine: 10,
            endLine: 12,
        });
    });
});
