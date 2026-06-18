import * as assert from 'assert';
import { suite, test } from 'mocha';
import * as vscode from 'vscode';

suite('Extension', () => {
    test('extension is present', () => {
        const ext = vscode.extensions.getExtension('zetaphor.pi-agent');
        assert.ok(ext, 'Extension should be installed');
    });

    test('commands are registered', async () => {
        const ext = vscode.extensions.getExtension('zetaphor.pi-agent');
        assert.ok(ext, 'Extension should be installed');
        await ext.activate();

        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes('pi-agent.newChat'), 'newChat command should exist');
        assert.ok(commands.includes('pi-agent.abort'), 'abort command should exist');
        assert.ok(commands.includes('pi-agent.selectModel'), 'selectModel command should exist');
        assert.ok(commands.includes('pi-agent.focusChat'), 'focusChat command should exist');
        assert.ok(commands.includes('pi-agent.addSelectionToChat'), 'addSelectionToChat command should exist');
    });
});
