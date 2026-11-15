import * as vscode from 'vscode';

// プリセット色の定義（メニューと1発コマンドで共通利用）
const PRESET_COLORS = {
  yellow: { name: '🟡 黄色 (Yellow)', code: 'rgba(255, 235, 59, 0.4)' },
  green:  { name: '🟢 緑色 (Green)',  code: 'rgba(76, 175, 80, 0.4)' },
  cyan:   { name: '🔵 水色 (Cyan)',   code: 'rgba(0, 188, 212, 0.4)' },
  pink:   { name: '🟣 ピンク (Pink)', code: 'rgba(233, 30, 99, 0.4)' },
  orange: { name: '🟠 オレンジ (Orange)', code: 'rgba(255, 152, 0, 0.4)' }
} as const;

const decorationMap = new Map<string, {
  type: vscode.TextEditorDecorationType;
  ranges: vscode.Range[];
}>();

/**
 * 既存のRange(target)から、消去・上書きしたいRange(eraser)と重なる部分をくり抜く関数
 */
function subtractRange(target: vscode.Range, eraser: vscode.Range): vscode.Range[] {
  const intersection = target.intersection(eraser);
  if (!intersection) {
    return [target];
  }
  const result: vscode.Range[] = [];
  if (target.start.isBefore(eraser.start)) {
    result.push(new vscode.Range(target.start, eraser.start));
  }
  if (target.end.isAfter(eraser.end)) {
    result.push(new vscode.Range(eraser.end, target.end));
  }
  return result;
}

/**
 * 同じ色のRangeが重なっていたり隣接している場合に1つに結合する関数
 */
function mergeRanges(ranges: vscode.Range[]): vscode.Range[] {
  if (ranges.length <= 1) {
    return ranges;
  }
  const sorted = [...ranges].sort((a, b) => a.start.compareTo(b.start));
  const merged: vscode.Range[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const current = sorted[i];
    if (prev.end.isAfterOrEqual(current.start)) {
      const newEnd = prev.end.isAfter(current.end) ? prev.end : current.end;
      merged[merged.length - 1] = new vscode.Range(prev.start, newEnd);
    } else {
      merged.push(current);
    }
  }
  return merged;
}

/**
 * テキスト編集イベントに合わせてRangeの座標を補正する関数
 */
function adjustRangeOnEdit(
  range: vscode.Range,
  change: vscode.TextDocumentContentChangeEvent,
  document: vscode.TextDocument
): vscode.Range | null {
  const editStartOffset = change.rangeOffset;
  const editEndOffset = change.rangeOffset + change.rangeLength;
  const delta = change.text.length - change.rangeLength;

  if (change.range.start.isAfterOrEqual(range.end)) {
    return range;
  }

  const calcOldOffset = (pos: vscode.Position): number => {
    if (pos.isBeforeOrEqual(change.range.start)) {
      return document.offsetAt(pos);
    }
    const lineDelta = change.text.split('\n').length - 1 - (change.range.end.line - change.range.start.line);
    if (pos.line > change.range.end.line) {
      const newPos = new vscode.Position(pos.line + lineDelta, pos.character);
      return document.offsetAt(newPos) - delta;
    } else {
      const newLineLines = change.text.split('\n');
      const lastLineLen = newLineLines[newLineLines.length - 1].length;
      const charDelta = (newLineLines.length === 1 ? change.range.start.character : 0) + lastLineLen - change.range.end.character;
      const newPos = new vscode.Position(pos.line + lineDelta, pos.character + charDelta);
      return document.offsetAt(newPos) - delta;
    }
  };

  const oldStart = calcOldOffset(range.start);
  const oldEnd = calcOldOffset(range.end);

  let newStart = oldStart >= editEndOffset ? oldStart + delta : (oldStart > editStartOffset ? editStartOffset + change.text.length : oldStart);
  let newEnd = oldEnd >= editEndOffset ? oldEnd + delta : (oldEnd > editStartOffset ? editStartOffset : oldEnd);

  if (newStart >= newEnd) {
    return null;
  }
  return new vscode.Range(document.positionAt(newStart), document.positionAt(newEnd));
}

/**
 * 【共通処理】指定したRange配列に、指定した背景色を上書き適用する関数
 */
function applyColorToRanges(editor: vscode.TextEditor, bgColor: string, targetRanges: vscode.Range[]) {
  if (targetRanges.length === 0) {
    return;
  }

  if (!decorationMap.has(bgColor)) {
    const decorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: bgColor,
      borderRadius: '2px',
      overviewRulerColor: bgColor,
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
    });
    decorationMap.set(bgColor, { type: decorationType, ranges: [] });
  }

  // 1. 既存のすべての色から今回塗る範囲をくり抜く（上書き）
  decorationMap.forEach((existingEntry) => {
    let updatedRanges = existingEntry.ranges;
    for (const newRange of targetRanges) {
      const nextRanges: vscode.Range[] = [];
      for (const r of updatedRanges) {
        nextRanges.push(...subtractRange(r, newRange));
      }
      updatedRanges = nextRanges;
    }
    existingEntry.ranges = updatedRanges;
  });

  // 2. 新しい色を追加して結合
  const targetEntry = decorationMap.get(bgColor)!;
  targetEntry.ranges.push(...targetRanges);
  targetEntry.ranges = mergeRanges(targetEntry.ranges);

  // 3. エディタに再描画
  decorationMap.forEach((entry) => {
    editor.setDecorations(entry.type, entry.ranges);
  });
}

/**
 * ファイル内から指定した単語と一致するすべてのRangeを検索して返す関数
 */
function findAllWordRanges(document: vscode.TextDocument, word: string): vscode.Range[] {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped, 'g');
  const fullText = document.getText();
  const ranges: vscode.Range[] = [];

  let match;
  while ((match = regex.exec(fullText)) !== null) {
    ranges.push(new vscode.Range(
      document.positionAt(match.index),
      document.positionAt(match.index + match[0].length)
    ));
  }
  return ranges;
}

/**
 * 現在の選択範囲（未選択ならカーソル位置の単語）のRange配列を取得する関数
 */
function getTargetRangesFromCursor(editor: vscode.TextEditor): vscode.Range[] {
  const ranges: vscode.Range[] = [];
  for (const selection of editor.selections) {
    if (!selection.isEmpty) {
      ranges.push(new vscode.Range(selection.start, selection.end));
    } else {
      const wordRange = editor.document.getWordRangeAtPosition(selection.active);
      if (wordRange) {
        ranges.push(wordRange);
      }
    }
  }
  return ranges;
}

export function activate(context: vscode.ExtensionContext) {

  // テキスト編集時の自動追従リスナー
  const changeDocumentListener = vscode.workspace.onDidChangeTextDocument((event) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || event.document !== editor.document || event.contentChanges.length === 0) {
      return;
    }
    for (const change of event.contentChanges) {
      decorationMap.forEach((entry) => {
        const updatedRanges: vscode.Range[] = [];
        for (const r of entry.ranges) {
          const adjusted = adjustRangeOnEdit(r, change, event.document);
          if (adjusted && !adjusted.isEmpty) {
            updatedRanges.push(adjusted);
          }
        }
        entry.ranges = mergeRanges(updatedRanges);
      });
    }
    decorationMap.forEach((entry) => {
      editor.setDecorations(entry.type, entry.ranges);
    });
  });

  // =========================================================================
  // 機能1：簡単なメニューUI（単語と色を選択して塗る）
  // =========================================================================
  const menuColorizeCommand = vscode.commands.registerCommand('my-first-extension.colorizeWithMenu', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    const selection = editor.selection;
    const initialWordRange = selection.isEmpty ? editor.document.getWordRangeAtPosition(selection.active) : selection;
    const currentWord = initialWordRange ? editor.document.getText(initialWordRange) : '';

    interface ModeItem extends vscode.QuickPickItem {
      mode: 'selection' | 'all_current' | 'input_word';
    }
    const modeItems: ModeItem[] = [];

    if (!selection.isEmpty) {
      modeItems.push({
        label: `$(paintbrush) 選択した範囲だけを塗る`,
        description: `「${currentWord}」の選択箇所のみ`,
        mode: 'selection'
      });
    }
    if (currentWord) {
      modeItems.push({
        label: `$(symbol-color) 「${currentWord}」をファイル内で一括で塗る`,
        description: '同じ単語をすべてハイライト',
        mode: 'all_current'
      });
    }
    modeItems.push({
      label: `$(search) 塗りたい単語を入力して一括で塗る...`,
      description: '任意の文字列を検索してハイライト',
      mode: 'input_word'
    });

    const selectedMode = await vscode.window.showQuickPick(modeItems, {
      title: 'ステップ 1/2: 塗る対象を選択',
      placeHolder: 'どこに色を付けますか？'
    });
    if (!selectedMode) {
      return;
    }

    let targetRanges: vscode.Range[] = [];
    if (selectedMode.mode === 'selection') {
      targetRanges = getTargetRangesFromCursor(editor);
    } else if (selectedMode.mode === 'all_current') {
      targetRanges = findAllWordRanges(editor.document, currentWord);
    } else if (selectedMode.mode === 'input_word') {
      const inputWord = await vscode.window.showInputBox({
        title: '塗りたい単語を入力',
        prompt: 'ファイル内で一括ハイライトする文字列を入力してください',
        value: currentWord
      });
      if (!inputWord) {
        return;
      }
      targetRanges = findAllWordRanges(editor.document, inputWord);
    }

    const colorOptions: vscode.QuickPickItem[] = Object.values(PRESET_COLORS).map(c => ({
      label: c.name,
      description: c.code
    }));
    colorOptions.push({ label: '🎨 カスタム色を入力...', description: 'custom' });

    const selectedColor = await vscode.window.showQuickPick(colorOptions, {
      title: 'ステップ 2/2: 背景色を選択',
      placeHolder: '塗りたい色を選んでください'
    });
    if (!selectedColor) {
      return;
    }

    let bgColor = selectedColor.description!;
    if (bgColor === 'custom') {
      const customInput = await vscode.window.showInputBox({
        prompt: 'カラーコードを入力（例: #ff0000, rgba(255,0,0,0.4)）',
        value: '#ffeb3b80'
      });
      if (!customInput) {
        return;
      }
      bgColor = customInput;
    }

    applyColorToRanges(editor, bgColor, targetRanges);
  });

  // =========================================================================
  // 機能2：メニューを出さずに「1発で色を塗る」ダイレクトコマンド群
  // =========================================================================
  const quickColorCommands = (Object.keys(PRESET_COLORS) as Array<keyof typeof PRESET_COLORS>).map((colorKey) => {
    const colorInfo = PRESET_COLORS[colorKey];
    return vscode.commands.registerCommand(`my-first-extension.quickColor.${colorKey}`, () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      const ranges = getTargetRangesFromCursor(editor);
      applyColorToRanges(editor, colorInfo.code, ranges);
    });
  });

  // 消しゴムコマンド（選択範囲またはカーソル位置の色を消す）
  const eraseSelectionCommand = vscode.commands.registerCommand('my-first-extension.eraseSelection', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    decorationMap.forEach((entry) => {
      let updatedRanges = entry.ranges;
      for (const selection of editor.selections) {
        if (selection.isEmpty) {
          updatedRanges = updatedRanges.filter(r => !r.contains(selection.active));
        } else {
          const eraseRange = new vscode.Range(selection.start, selection.end);
          const nextRanges: vscode.Range[] = [];
          for (const r of updatedRanges) {
            nextRanges.push(...subtractRange(r, eraseRange));
          }
          updatedRanges = nextRanges;
        }
      }
      entry.ranges = updatedRanges;
      editor.setDecorations(entry.type, entry.ranges);
    });
  });

  // すべてクリアするコマンド
  const clearAllCommand = vscode.commands.registerCommand('my-first-extension.clearAllColors', () => {
    decorationMap.forEach(entry => entry.type.dispose());
    decorationMap.clear();
  });

  context.subscriptions.push(
    changeDocumentListener,
    menuColorizeCommand,
    ...quickColorCommands,
    eraseSelectionCommand,
    clearAllCommand
  );
}

export function deactivate() {
  decorationMap.forEach(entry => entry.type.dispose());
}
