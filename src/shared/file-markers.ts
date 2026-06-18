import type { FileReferenceInfo } from './protocol';

export interface ParsedFileMarker {
    raw: string;
    path: string;
    startLine?: number;
    endLine?: number;
}

export function formatFileRange(startLine?: number, endLine?: number): string {
    if (!startLine) {
        return '';
    }

    if (!endLine || endLine === startLine) {
        return String(startLine);
    }

    return `${startLine}-${endLine}`;
}

export function buildInlineFileMarker(file: Pick<FileReferenceInfo, 'relativePath' | 'absolutePath' | 'startLine' | 'endLine'>): string {
    const path = file.absolutePath ?? file.relativePath;
    const range = formatFileRange(file.startLine, file.endLine);
    return `[[file:${path}${range ? `:${range}` : ''}]]`;
}

export function parseInlineFileMarker(raw: string): ParsedFileMarker | null {
    const match = raw.match(/^\[\[file:(.+)\]\]$/);
    if (!match) {
        return null;
    }

    const body = match[1];
    const rangeMatch = body.match(/^(.*?):(\d+)(?:-(\d+))?$/);
    if (!rangeMatch) {
        return { raw, path: body };
    }

    const path = rangeMatch[1];
    const startLine = Number(rangeMatch[2]);
    const endLine = Number(rangeMatch[3] ?? rangeMatch[2]);
    if (!Number.isInteger(startLine) || startLine < 1 || !Number.isInteger(endLine) || endLine < startLine) {
        return { raw, path: body };
    }

    return { raw, path, startLine, endLine };
}

export function replaceInlineFileMarkers(text: string, replacer: (marker: ParsedFileMarker) => string): string {
    return text.replace(/\[\[file:[^\]]+\]\]/g, (raw) => {
        const parsed = parseInlineFileMarker(raw);
        return parsed ? replacer(parsed) : raw;
    });
}
