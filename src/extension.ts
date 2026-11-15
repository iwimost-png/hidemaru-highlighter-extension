import * as vscode from 'vscode';

// プリセット色のベースRGB値
const PRESET_BASE_COLORS = {
  yellow: { name: '🟡 黄色 (Yellow)', rgb: '255, 235, 59' },
  green:  { name: '🟢 緑色 (Green)',  rgb: '76, 175, 80' },
  cyan:   { name: '🔵 水色 (Cyan)',   rgb: '0, 188, 212' },
  pink:   { name: '🟣 ピンク (Pink)', rgb: '233, 30, 99' },
  orange: { name: '🟠 オレンジ (Orange)', rgb: '255, 152, 0' }
} as const;

type PresetColorKey = keyof typeof PRESET_BASE_COLORS;

/** ドキュメント内のオフセット（0始まりの文字位置）による範囲表現 */
interface HighlightRange {
  start: number;
  end: number;
}

/** 一括ハイライトの安全上限件数（VS Codeのパフォーマンス低下・フリーズ防止用） */
const MAX_MATCH_LIMIT = 2000;

/** 永続化ストレージのキー */
const STORAGE_KEY = 'hidemaru_highlighter_storage_v2';
const LEGACY_STORAGE_KEY = 'hidemaru_highlighter_storage_v1';

// 実効カラーコード（rgba(...)） -> DecorationType のプール
const decorationTypes = new Map<string, vscode.TextEditorDecorationType>();

// ドキュメントごとのハイライトデータ（documentUriString -> (colorKey -> HighlightRange[])）
// colorKey は 'yellow' 等のプリセットキー、または '#ff0000' などのカスタム色コード
const documentHighlightMap = new Map<string, Map<string, HighlightRange[]>>();

// 直前の全消去バックアップ（Undo復元用）: docKey -> colorMap
const undoClearBackupMap = new Map<string, Map<string, HighlightRange[]>>();

// 拡張機能コンテキストの参照（deactivate時のフラッシュ保存用）
let extensionContext: vscode.ExtensionContext | undefined;

// 保存用 debounce タイマー
let saveTimeout: NodeJS.Timeout | undefined;

// ステータスバーアイテム
let statusBarItem: vscode.StatusBarItem | undefined;

/**
 * プリセット色のキーかどうか判定
 */
function isPresetKey(key: string): key is PresetColorKey {
  return key in PRESET_BASE_COLORS;
}

/**
 * 設定からマーカーの不透明度（opacity: 0.1 〜 1.0）を取得
 */
function getMarkerOpacity(): number {
  const config = vscode.workspace.getConfiguration('hidemaruHighlighter');
  const opacity = config.get<number>('opacity', 0.4);
  return Math.min(Math.max(opacity, 0.1), 1.0);
}

/**
 * カラーキーから現在有効な表示名とカラーコード（rgba）を取得
 */
function getColorInfo(colorKey: string): { name: string; code: string } {
  if (isPresetKey(colorKey)) {
    const preset = PRESET_BASE_COLORS[colorKey];
    const opacity = getMarkerOpacity();
    return {
      name: preset.name,
      code: `rgba(${preset.rgb}, ${opacity})`
    };
  }
  return {
    name: `🎨 カスタム (${colorKey})`,
    code: colorKey
  };
}

/**
 * 旧バージョンのカラーコード文字列（rgba(...)）をプリセットキーに変換（後方互換マイグレーション）
 */
function normalizeColorKey(colorKey: string): string {
  for (const [key, info] of Object.entries(PRESET_BASE_COLORS)) {
    if (colorKey.includes(info.rgb)) {
      return key;
    }
  }
  return colorKey;
}

/**
 * カラーコードの有効性を検証する（HEX, RGB, RGBA, HSL, HSLA, 一般的な色名）
 */
function isValidCssColor(color: string): boolean {
  if (!color || typeof color !== 'string') {
    return false;
  }
  const trimmed = color.trim();
  if (/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)) {
    return true;
  }
  if (/^rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?(\s*,\s*[\d.]+%?)?\s*\)$/i.test(trimmed)) {
    return true;
  }
  if (/^hsla?\(\s*[\d.]+\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?(\s*,\s*[\d.]+%?)?\s*\)$/i.test(trimmed)) {
    return true;
  }
  if (/^[a-zA-Z]{3,20}$/.test(trimmed)) {
    return true;
  }
  return false;
}

/**
 * 色コードに対応する TextEditorDecorationType を取得、無ければ新規生成
 * ※ 両端での文字入力時にハイライトが一瞬伸びて縮むチラつき（フリッカー）を防ぐため OpenOpen を指定
 */
function getOrCreateDecorationType(colorCode: string): vscode.TextEditorDecorationType {
  let decType = decorationTypes.get(colorCode);
  if (!decType) {
    decType = vscode.window.createTextEditorDecorationType({
      backgroundColor: colorCode,
      borderRadius: '2px',
      overviewRulerColor: colorCode,
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen
    });
    decorationTypes.set(colorCode, decType);
  }
  return decType;
}

/**
 * ハイライトデータをワークスペースストレージ（永続化領域）に保存
 */
function saveHighlights(context: vscode.ExtensionContext) {
  const serializable: Record<string, Record<string, HighlightRange[]>> = {};
  documentHighlightMap.forEach((colorMap, docKey) => {
    const docData: Record<string, HighlightRange[]> = {};
    colorMap.forEach((ranges, colorKey) => {
      if (ranges.length > 0) {
        docData[colorKey] = ranges;
      }
    });
    if (Object.keys(docData).length > 0) {
      serializable[docKey] = docData;
    }
  });
  context.workspaceState.update(STORAGE_KEY, serializable);
}

/**
 * ワークスペースストレージからハイライトデータを復元（旧バージョンからの自動マイグレーション対応）
 */
function loadHighlights(context: vscode.ExtensionContext) {
  let saved = context.workspaceState.get<Record<string, Record<string, HighlightRange[]>>>(STORAGE_KEY);
  if (!saved) {
    saved = context.workspaceState.get<Record<string, Record<string, HighlightRange[]>>>(LEGACY_STORAGE_KEY);
  }
  if (!saved) {
    return;
  }
  for (const [docKey, docData] of Object.entries(saved)) {
    const colorMap = new Map<string, HighlightRange[]>();
    for (const [rawColorKey, ranges] of Object.entries(docData)) {
      if (ranges && ranges.length > 0) {
        const normalizedKey = normalizeColorKey(rawColorKey);
        const existing = colorMap.get(normalizedKey) || [];
        existing.push(...ranges);
        colorMap.set(normalizedKey, mergeOffsetRanges(existing));
      }
    }
    if (colorMap.size > 0) {
      documentHighlightMap.set(docKey, colorMap);
    }
  }
}

/**
 * 既存のオフセット範囲(target)から、消去・上書きしたい範囲(eraser)と重なる部分をくり抜く
 */
function subtractOffsetRange(target: HighlightRange, eraser: HighlightRange): HighlightRange[] {
  if (target.end <= eraser.start || target.start >= eraser.end) {
    return [target];
  }
  const result: HighlightRange[] = [];
  if (target.start < eraser.start) {
    result.push({ start: target.start, end: eraser.start });
  }
  if (target.end > eraser.end) {
    result.push({ start: eraser.end, end: target.end });
  }
  return result;
}

/**
 * 同じ色の範囲が重なっていたり隣接している場合に1つに結合する
 */
function mergeOffsetRanges(ranges: HighlightRange[]): HighlightRange[] {
  const valid = ranges.filter(r => r.start < r.end);
  if (valid.length <= 1) {
    return valid;
  }
  const sorted = [...valid].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: HighlightRange[] = [{ start: sorted[0].start, end: sorted[0].end }];

  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const current = sorted[i];
    if (prev.end >= current.start) {
      prev.end = Math.max(prev.end, current.end);
    } else {
      merged.push({ start: current.start, end: current.end });
    }
  }
  return merged;
}

/**
 * 編集内容に合わせてオフセット範囲を追従・伸縮させる関数
 */
function adjustOffsetRange(
  range: HighlightRange,
  changeStart: number,
  changeLength: number,
  insertedLength: number
): HighlightRange | null {
  const changeEnd = changeStart + changeLength;
  const delta = insertedLength - changeLength;

  if (range.end <= changeStart) {
    return range;
  }
  if (range.start >= changeEnd) {
    return {
      start: range.start + delta,
      end: range.end + delta
    };
  }
  if (range.start >= changeStart && range.end <= changeEnd) {
    return null;
  }
  if (range.start < changeStart && range.end > changeEnd) {
    return {
      start: range.start,
      end: range.end + delta
    };
  }
  if (range.start >= changeStart && range.start < changeEnd && range.end > changeEnd) {
    const newStart = changeStart + insertedLength;
    const newEnd = range.end + delta;
    return newStart < newEnd ? { start: newStart, end: newEnd } : null;
  }
  if (range.start < changeStart && range.end > changeStart && range.end <= changeEnd) {
    const newEnd = changeStart;
    return range.start < newEnd ? { start: range.start, end: newEnd } : null;
  }
  return null;
}

/**
 * 指定したドキュメントを開いているすべての可視エディタ（分割エディタ含む）にデコレーションを描画
 */
function renderDecorations(document: vscode.TextDocument) {
  const docKey = document.uri.toString();
  const colorMap = documentHighlightMap.get(docKey);

  const visibleEditors = vscode.window.visibleTextEditors.filter(
    e => e.document === document || e.document.uri.toString() === docKey
  );
  if (visibleEditors.length === 0) {
    return;
  }

  const docTextLength = document.getText().length;

  // 使用されている全カラーキーから実効 DecorationType を取得して描画
  const activeColorKeys = new Set<string>();
  if (colorMap) {
    for (const key of colorMap.keys()) {
      activeColorKeys.add(key);
    }
  }
  // プリセット色キーは常時カバー
  (Object.keys(PRESET_BASE_COLORS) as PresetColorKey[]).forEach(k => activeColorKeys.add(k));

  activeColorKeys.forEach((colorKey) => {
    const info = getColorInfo(colorKey);
    const decType = getOrCreateDecorationType(info.code);
    const offsetRanges = colorMap?.get(colorKey) || [];

    const vscodeRanges = offsetRanges
      .filter(r => r.start < r.end && r.start < docTextLength)
      .map(r => new vscode.Range(document.positionAt(r.start), document.positionAt(Math.min(r.end, docTextLength))))
      .filter(r => !r.isEmpty);

    for (const editor of visibleEditors) {
      editor.setDecorations(decType, vscodeRanges);
    }
  });

  updateStatusBar(vscode.window.activeTextEditor);
}

/**
 * ステータスバーの表示を更新
 */
function updateStatusBar(editor?: vscode.TextEditor) {
  if (!statusBarItem) {
    return;
  }
  const config = vscode.workspace.getConfiguration('hidemaruHighlighter');
  if (!config.get<boolean>('showStatusBarItem', true)) {
    statusBarItem.hide();
    return;
  }

  if (!editor) {
    statusBarItem.text = '$(paintbrush) マーカー';
    statusBarItem.tooltip = 'クリックしてマーカーメニューを開く (Alt + M)';
    statusBarItem.show();
    return;
  }

  const docKey = editor.document.uri.toString();
  const colorMap = documentHighlightMap.get(docKey);
  let totalCount = 0;
  if (colorMap) {
    colorMap.forEach((ranges) => {
      totalCount += ranges.length;
    });
  }

  if (totalCount > 0) {
    statusBarItem.text = `$(paintbrush) ${totalCount}`;
    statusBarItem.tooltip = `このファイルに ${totalCount} 箇所のハイライトがあります（クリックでメニュー）`;
  } else {
    statusBarItem.text = `$(paintbrush) マーカー`;
    statusBarItem.tooltip = 'ハイライトなし（クリックでマーカーメニューを開く）';
  }
  statusBarItem.show();
}

/**
 * 指定したドキュメントの指定色キーにオフセット範囲を上書き適用する
 */
function applyColorToOffsets(
  document: vscode.TextDocument,
  colorKey: string,
  targetOffsets: HighlightRange[],
  context: vscode.ExtensionContext
) {
  if (targetOffsets.length === 0) {
    return;
  }

  const docKey = document.uri.toString();
  let colorMap = documentHighlightMap.get(docKey);
  if (!colorMap) {
    colorMap = new Map<string, HighlightRange[]>();
    documentHighlightMap.set(docKey, colorMap);
  }

  // 1. 既存のすべての色から今回塗る範囲をくり抜く（上書き）
  colorMap.forEach((ranges, cKey) => {
    let updated = ranges;
    for (const newRange of targetOffsets) {
      const next: HighlightRange[] = [];
      for (const r of updated) {
        next.push(...subtractOffsetRange(r, newRange));
      }
      updated = next;
    }
    colorMap!.set(cKey, updated);
  });

  // 2. 新しい色を追加して結合
  const currentRanges = colorMap.get(colorKey) || [];
  currentRanges.push(...targetOffsets);
  colorMap.set(colorKey, mergeOffsetRanges(currentRanges));

  // 3. エディタに再描画と保存
  renderDecorations(document);
  saveHighlights(context);

  // 4. 件数フィードバック
  vscode.window.setStatusBarMessage(`🎨 ${targetOffsets.length} 箇所をハイライトしました`, 3000);
}

/**
 * ファイル内から指定した単語・文字列と一致するすべてのオフセット範囲を検索して返す
 * ※ 改行コードの差異（CRLF / LF）を正規化し、日本語や記号にも確実に対応
 */
function findAllWordRanges(
  document: vscode.TextDocument,
  word: string,
  wholeWord: boolean,
  ignoreCase: boolean = false
): { ranges: HighlightRange[]; hitLimit: boolean } {
  if (!word || word.length === 0) {
    return { ranges: [], hitLimit: false };
  }
  // 特殊文字エスケープと改行コード正規化
  let escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  escaped = escaped.replace(/\r\n|\r|\n/g, '\\r?\\n');

  // \b は ASCII英数字のみの場合のみ有効
  const isAsciiWord = /^\w+$/.test(word);
  const pattern = (wholeWord && isAsciiWord) ? `\\b${escaped}\\b` : escaped;
  const flags = ignoreCase ? 'gi' : 'g';

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, flags);
  } catch {
    regex = new RegExp(escaped, flags);
  }

  const fullText = document.getText();
  const ranges: HighlightRange[] = [];
  let hitLimit = false;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(fullText)) !== null) {
    if (match[0].length === 0) {
      regex.lastIndex++;
      continue;
    }
    ranges.push({
      start: match.index,
      end: match.index + match[0].length
    });
    if (ranges.length >= MAX_MATCH_LIMIT) {
      hitLimit = true;
      break;
    }
  }
  return { ranges, hitLimit };
}

/**
 * 現在の選択範囲（未選択ならカーソル位置の単語）のオフセット配列を取得する
 */
function getTargetOffsetRangesFromCursor(editor: vscode.TextEditor): HighlightRange[] {
  const doc = editor.document;
  const results: HighlightRange[] = [];

  for (const selection of editor.selections) {
    if (!selection.isEmpty) {
      results.push({
        start: doc.offsetAt(selection.start),
        end: doc.offsetAt(selection.end)
      });
    } else {
      const wordRange = doc.getWordRangeAtPosition(selection.active);
      if (wordRange) {
        results.push({
          start: doc.offsetAt(wordRange.start),
          end: doc.offsetAt(wordRange.end)
        });
      }
    }
  }
  return mergeOffsetRanges(results);
}

/**
 * 次または前のハイライト箇所へカーソルをジャンプさせる
 * ※ キャレットを先頭に配置（全選択しない）することで誤入力による単語消失事故を防止
 */
function jumpToHighlight(editor: vscode.TextEditor, direction: 'next' | 'prev') {
  const doc = editor.document;
  const docKey = doc.uri.toString();
  const colorMap = documentHighlightMap.get(docKey);
  if (!colorMap || colorMap.size === 0) {
    vscode.window.setStatusBarMessage('ハイライト（マーカー）が見つかりません。', 2500);
    return;
  }

  const allRanges: HighlightRange[] = [];
  colorMap.forEach((ranges) => {
    allRanges.push(...ranges);
  });
  if (allRanges.length === 0) {
    vscode.window.setStatusBarMessage('ハイライト（マーカー）が見つかりません。', 2500);
    return;
  }
  allRanges.sort((a, b) => a.start - b.start);

  const currentSelection = editor.selection;
  const currentStart = doc.offsetAt(currentSelection.start);

  let target: HighlightRange | null = null;

  if (direction === 'next') {
    target = allRanges.find(r => r.start > currentStart) || allRanges[0];
  } else {
    for (let i = allRanges.length - 1; i >= 0; i--) {
      if (allRanges[i].start < currentStart) {
        target = allRanges[i];
        break;
      }
    }
    if (!target) {
      target = allRanges[allRanges.length - 1];
    }
  }

  if (target) {
    const targetPos = doc.positionAt(target.start);
    const targetRange = new vscode.Range(targetPos, doc.positionAt(target.end));
    // キャレットをマーカーの先頭に配置（選択反転させない）
    editor.selection = new vscode.Selection(targetPos, targetPos);
    editor.revealRange(targetRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    const lineNum = targetPos.line + 1;
    const previewText = doc.getText(targetRange);
    const shortText = previewText.length > 20 ? previewText.slice(0, 20) + '...' : previewText;
    vscode.window.setStatusBarMessage(`📍 マーカーへジャンプ (${lineNum} 行目: 「${shortText}」)`, 2500);
  }
}

/**
 * ファイル内の全マーカーを一覧表示し、リアルタイムプレビュー＆ジャンプする機能
 */
async function showHighlightList(editor: vscode.TextEditor) {
  const doc = editor.document;
  const docKey = doc.uri.toString();
  const colorMap = documentHighlightMap.get(docKey);
  if (!colorMap || colorMap.size === 0) {
    vscode.window.showInformationMessage('このファイルにはハイライトがありません。');
    return;
  }

  interface MarkerItem extends vscode.QuickPickItem {
    range: vscode.Range;
  }

  const items: MarkerItem[] = [];
  colorMap.forEach((ranges, colorKey) => {
    const info = getColorInfo(colorKey);
    for (const r of ranges) {
      const startPos = doc.positionAt(r.start);
      const endPos = doc.positionAt(r.end);
      const range = new vscode.Range(startPos, endPos);
      const text = doc.getText(range);
      const displayText = text.replace(/\r?\n/g, '↵ ').trim();
      const shortText = displayText.length > 40 ? displayText.slice(0, 40) + '...' : displayText;

      items.push({
        label: `${info.name.split(' ')[0]} ${shortText}`,
        description: `Line ${startPos.line + 1}:${startPos.character + 1}`,
        detail: doc.lineAt(startPos.line).text.trim(),
        range
      });
    }
  });

  if (items.length === 0) {
    vscode.window.showInformationMessage('このファイルにはハイライトがありません。');
    return;
  }

  // 行番号・列番号順にソート
  items.sort((a, b) => a.range.start.compareTo(b.range.start));

  const initialSelection = editor.selection;
  const quickPick = vscode.window.createQuickPick<MarkerItem>();
  quickPick.title = `マーカー一覧（全 ${items.length} 箇所）`;
  quickPick.placeholder = 'マーカーを検索または上下キーで選択（リアルタイムプレビュー）';
  quickPick.items = items;

  // 上下キー移動でリアルタイムに該当行へスクロールプレビュー
  quickPick.onDidChangeActive((activeItems) => {
    if (activeItems.length > 0) {
      const activeRange = activeItems[0].range;
      editor.revealRange(activeRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
  });

  // Enter決定
  quickPick.onDidAccept(() => {
    const selected = quickPick.selectedItems[0];
    if (selected) {
      editor.selection = new vscode.Selection(selected.range.start, selected.range.start);
      editor.revealRange(selected.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
    quickPick.dispose();
  });

  // キャンセル時は元のカーソル位置に戻す
  quickPick.onDidHide(() => {
    if (quickPick.selectedItems.length === 0) {
      editor.selection = initialSelection;
      editor.revealRange(initialSelection);
    }
    quickPick.dispose();
  });

  quickPick.show();
}

/**
 * 指定した色だけを一括消去する
 */
async function clearSpecificColor(editor: vscode.TextEditor, context: vscode.ExtensionContext) {
  const doc = editor.document;
  const docKey = doc.uri.toString();
  const colorMap = documentHighlightMap.get(docKey);
  if (!colorMap || colorMap.size === 0) {
    vscode.window.showInformationMessage('このファイルにはハイライトがありません。');
    return;
  }

  const activeColors: { label: string; description: string; key: string; count: number }[] = [];
  colorMap.forEach((ranges, colorKey) => {
    if (ranges.length > 0) {
      const info = getColorInfo(colorKey);
      activeColors.push({
        label: info.name,
        description: `${ranges.length} 箇所`,
        key: colorKey,
        count: ranges.length
      });
    }
  });

  if (activeColors.length === 0) {
    vscode.window.showInformationMessage('このファイルにはハイライトがありません。');
    return;
  }

  const selected = await vscode.window.showQuickPick(activeColors, {
    title: '消去したいマーカーの色を選択',
    placeHolder: 'どの色のハイライトを消去しますか？'
  });
  if (!selected) {
    return;
  }

  colorMap.delete(selected.key);
  renderDecorations(doc);
  saveHighlights(context);
  vscode.window.setStatusBarMessage(`「${selected.label}」のマーカー（${selected.count}箇所）を消去しました。`, 3000);
}

/**
 * 現在のファイルのマーカーを全消去（Undo復元機能付き）
 */
function clearCurrentDocumentColors(editor: vscode.TextEditor, context: vscode.ExtensionContext) {
  const docKey = editor.document.uri.toString();
  const colorMap = documentHighlightMap.get(docKey);
  if (!colorMap || colorMap.size === 0) {
    vscode.window.setStatusBarMessage('消去するハイライトがありません。', 2000);
    return;
  }

  let totalCount = 0;
  colorMap.forEach(ranges => totalCount += ranges.length);

  // Undo復元用にバックアップを作成
  const backup = new Map<string, HighlightRange[]>();
  colorMap.forEach((ranges, key) => {
    backup.set(key, [...ranges]);
  });
  undoClearBackupMap.set(docKey, backup);

  // マーカーをクリア
  documentHighlightMap.delete(docKey);
  renderDecorations(editor.document);
  saveHighlights(context);

  // 「元に戻す」アクション付きの通知を表示
  vscode.window.showInformationMessage(
    `このファイルのマーカー（全${totalCount}箇所）を消去しました。`,
    '元に戻す (Undo)'
  ).then(action => {
    if (action === '元に戻す (Undo)') {
      const restored = undoClearBackupMap.get(docKey);
      if (restored) {
        documentHighlightMap.set(docKey, restored);
        undoClearBackupMap.delete(docKey);
        renderDecorations(editor.document);
        saveHighlights(context);
        vscode.window.setStatusBarMessage('マーカーを元に戻しました。', 2500);
      }
    }
  });
}

export function activate(context: vscode.ExtensionContext) {
  extensionContext = context;

  // ステータスバーアイテムの作成
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'hidemaru-highlighter.colorizeWithMenu';
  updateStatusBar(vscode.window.activeTextEditor);

  // 起動時に永続化ストレージからハイライトを復元
  loadHighlights(context);
  for (const editor of vscode.window.visibleTextEditors) {
    renderDecorations(editor.document);
  }

  // 1. テキスト編集時の自動追従リスナー（オフセットベースで安全かつ正確に追従）
  const changeDocumentListener = vscode.workspace.onDidChangeTextDocument((event) => {
    const docKey = event.document.uri.toString();
    const colorMap = documentHighlightMap.get(docKey);
    if (!colorMap || event.contentChanges.length === 0) {
      return;
    }

    const sortedChanges = [...event.contentChanges].sort((a, b) => b.rangeOffset - a.rangeOffset);

    for (const change of sortedChanges) {
      const changeStart = change.rangeOffset;
      const changeLength = change.rangeLength;
      const insertedLength = change.text.length;

      colorMap.forEach((ranges, colorKey) => {
        const updatedRanges: HighlightRange[] = [];
        for (const r of ranges) {
          const adjusted = adjustOffsetRange(r, changeStart, changeLength, insertedLength);
          if (adjusted && adjusted.start < adjusted.end) {
            updatedRanges.push(adjusted);
          }
        }
        colorMap.set(colorKey, mergeOffsetRanges(updatedRanges));
      });
    }

    renderDecorations(event.document);

    // 連続編集時の保存負荷を軽減（debounce）
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    saveTimeout = setTimeout(() => {
      saveHighlights(context);
    }, 500);
  });

  // 2. エディタ切り替え・分割ビュー表示時の再描画リスナー
  const activeEditorListener = vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor) {
      renderDecorations(editor.document);
    }
    updateStatusBar(editor);
  });

  const visibleEditorsListener = vscode.window.onDidChangeVisibleTextEditors((editors) => {
    const visitedDocs = new Set<string>();
    for (const editor of editors) {
      const docKey = editor.document.uri.toString();
      if (!visitedDocs.has(docKey)) {
        visitedDocs.add(docKey);
        renderDecorations(editor.document);
      }
    }
  });

  // 3. ファイル名変更（リネーム・名前を付けて保存）時のハイライト引き継ぎリスナー
  const renameFilesListener = vscode.workspace.onDidRenameFiles((event) => {
    let changed = false;
    for (const file of event.files) {
      const oldKey = file.oldUri.toString();
      const newKey = file.newUri.toString();
      if (documentHighlightMap.has(oldKey)) {
        documentHighlightMap.set(newKey, documentHighlightMap.get(oldKey)!);
        documentHighlightMap.delete(oldKey);
        changed = true;
      }
    }
    if (changed) {
      saveHighlights(context);
      if (vscode.window.activeTextEditor) {
        renderDecorations(vscode.window.activeTextEditor.document);
      }
    }
  });

  // 4. ファイル削除時のハイライトクリーンアップリスナー
  const deleteFilesListener = vscode.workspace.onDidDeleteFiles((event) => {
    let changed = false;
    for (const file of event.files) {
      const key = file.toString();
      if (documentHighlightMap.has(key)) {
        documentHighlightMap.delete(key);
        changed = true;
      }
    }
    if (changed) {
      saveHighlights(context);
    }
  });

  // 5. 設定変更リスナー（不透明度やステータスバー表示の動的変更）
  const configListener = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('hidemaruHighlighter')) {
      // 不透明度が変更された場合は古いDecorationTypeを破棄して再生成
      decorationTypes.forEach(dec => dec.dispose());
      decorationTypes.clear();

      updateStatusBar(vscode.window.activeTextEditor);
      for (const editor of vscode.window.visibleTextEditors) {
        renderDecorations(editor.document);
      }
    }
  });

  // コマンド登録用のヘルパー（新IDと旧IDの両方を登録して後方互換性を保証）
  const registerCommand = (subId: string, callback: (...args: any[]) => any) => {
    const d1 = vscode.commands.registerCommand(`hidemaru-highlighter.${subId}`, callback);
    const d2 = vscode.commands.registerCommand(`my-first-extension.${subId}`, callback);
    context.subscriptions.push(d1, d2);
  };

  // =========================================================================
  // 機能1：メニューUI（単語と色を選択して塗る / 全件消去もここから実行可能）
  // =========================================================================
  registerCommand('colorizeWithMenu', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage('エディタが開かれていません。テキストファイルを開いてから実行してください。');
      return;
    }

    const docKey = editor.document.uri.toString();
    const colorMap = documentHighlightMap.get(docKey);
    let currentDocMarkerCount = 0;
    if (colorMap) {
      colorMap.forEach(ranges => currentDocMarkerCount += ranges.length);
    }

    const selection = editor.selection;
    const initialWordRange = selection.isEmpty ? editor.document.getWordRangeAtPosition(selection.active) : selection;
    const currentWord = initialWordRange ? editor.document.getText(initialWordRange) : '';
    const displayWord = currentWord.length > 30 ? currentWord.slice(0, 30) + '...' : currentWord;
    const isAsciiWord = /^\w+$/.test(currentWord);

    interface ModeItem extends vscode.QuickPickItem {
      mode: 'selection' | 'all_current_word' | 'all_current_exact' | 'all_current_ignore_case' | 'input_word' | 'clear_current' | 'clear_specific' | 'clear_all';
    }
    const modeItems: ModeItem[] = [];

    if (!selection.isEmpty) {
      modeItems.push({
        label: `$(paintbrush) 選択した範囲だけを塗る`,
        description: `「${displayWord}」の選択箇所のみ`,
        mode: 'selection'
      });
    }
    if (currentWord) {
      modeItems.push({
        label: isAsciiWord
          ? `$(symbol-color) 「${displayWord}」をファイル内で一括で塗る（単語完全一致）`
          : `$(symbol-color) 「${displayWord}」をファイル内で一括で塗る（完全一致）`,
        description: isAsciiWord ? '単語全体が一致する箇所をハイライト' : '文字列が一致するすべての箇所をハイライト',
        mode: 'all_current_word'
      });
      if (isAsciiWord) {
        modeItems.push({
          label: `$(search) 「${displayWord}」をファイル内で一括で塗る（部分一致）`,
          description: '他の単語に含まれる箇所もハイライト',
          mode: 'all_current_exact'
        });
      }
      modeItems.push({
        label: `$(case-sensitive) 「${displayWord}」を一括で塗る（大文字小文字を区別しない）`,
        description: isAsciiWord ? '単語として一致（大文字・小文字無視）' : '文字列が一致（大文字・小文字無視）',
        mode: 'all_current_ignore_case'
      });
    }
    modeItems.push({
      label: `$(edit) 塗りたい文字列を入力して一括で塗る...`,
      description: '任意の文字列を検索してハイライト',
      mode: 'input_word'
    });

    // 消去関連メニューの追加
    if (currentDocMarkerCount > 0) {
      modeItems.push({
        label: `$(clear-all) 🧹 このファイルのマーカーを全消去 (${currentDocMarkerCount}箇所)`,
        description: '現在開いているファイルのすべてのマーカーを消去 (Shift+Alt+0 / Alt+C)',
        mode: 'clear_current'
      });
      modeItems.push({
        label: `$(symbol-color) 🎨 指定した色のマーカーを一括消去...`,
        description: '特定の色（例: 黄色だけ）を選んで消去',
        mode: 'clear_specific'
      });
    }
    if (documentHighlightMap.size > 0) {
      modeItems.push({
        label: `$(trash) 🗑️ すべてのファイルのマーカーを全消去...`,
        description: '全ファイルのすべてのマーカーを消去',
        mode: 'clear_all'
      });
    }

    const selectedMode = await vscode.window.showQuickPick(modeItems, {
      title: 'ステップ 1/2: 塗る対象（または消去）を選択',
      placeHolder: 'どこに色を付けますか？ またはマーカーを消去しますか？'
    });
    if (!selectedMode) {
      return;
    }

    // 消去モードが選ばれた場合は直ちに実行
    if (selectedMode.mode === 'clear_current') {
      clearCurrentDocumentColors(editor, context);
      return;
    }
    if (selectedMode.mode === 'clear_specific') {
      clearSpecificColor(editor, context);
      return;
    }
    if (selectedMode.mode === 'clear_all') {
      const answer = await vscode.window.showWarningMessage(
        'すべてのファイルのマーカーを全消去しますか？',
        { modal: true },
        '全消去する'
      );
      if (answer === '全消去する') {
        documentHighlightMap.clear();
        for (const ed of vscode.window.visibleTextEditors) {
          renderDecorations(ed.document);
        }
        saveHighlights(context);
        vscode.window.setStatusBarMessage('すべてのファイルのハイライトをクリアしました。', 2500);
      }
      return;
    }

    let targetOffsets: HighlightRange[] = [];
    let hitLimit = false;

    if (selectedMode.mode === 'selection') {
      targetOffsets = getTargetOffsetRangesFromCursor(editor);
    } else if (selectedMode.mode === 'all_current_word') {
      const result = findAllWordRanges(editor.document, currentWord, true, false);
      targetOffsets = result.ranges;
      hitLimit = result.hitLimit;
    } else if (selectedMode.mode === 'all_current_exact') {
      const result = findAllWordRanges(editor.document, currentWord, false, false);
      targetOffsets = result.ranges;
      hitLimit = result.hitLimit;
    } else if (selectedMode.mode === 'all_current_ignore_case') {
      const result = findAllWordRanges(editor.document, currentWord, isAsciiWord, true);
      targetOffsets = result.ranges;
      hitLimit = result.hitLimit;
    } else if (selectedMode.mode === 'input_word') {
      const inputWord = await vscode.window.showInputBox({
        title: '塗りたい文字列を入力',
        prompt: 'ファイル内で一括ハイライトする文字列を入力してください',
        value: currentWord
      });
      if (!inputWord) {
        return;
      }
      const result = findAllWordRanges(editor.document, inputWord, false, false);
      targetOffsets = result.ranges;
      hitLimit = result.hitLimit;
    }

    if (targetOffsets.length === 0) {
      vscode.window.showInformationMessage('ハイライト対象の箇所が見つかりませんでした。');
      return;
    }

    if (hitLimit) {
      vscode.window.showWarningMessage(`ハイライト件数が上限（${MAX_MATCH_LIMIT}件）に達したため、最初の${MAX_MATCH_LIMIT}件のみハイライトします。`);
    }

    const colorOptions: vscode.QuickPickItem[] = (Object.keys(PRESET_BASE_COLORS) as PresetColorKey[]).map(key => ({
      label: PRESET_BASE_COLORS[key].name,
      description: key
    }));
    colorOptions.push({ label: '🎨 カスタム色を入力...', description: 'custom' });

    const selectedColor = await vscode.window.showQuickPick(colorOptions, {
      title: 'ステップ 2/2: 背景色を選択',
      placeHolder: '塗りたい色を選んでください'
    });
    if (!selectedColor) {
      return;
    }

    let chosenColorKey = selectedColor.description!;
    if (chosenColorKey === 'custom') {
      const customInput = await vscode.window.showInputBox({
        prompt: 'カラーコードを入力（例: #ff0000, rgba(255,0,0,0.4), #ffeb3b80）',
        value: `rgba(255, 235, 59, ${getMarkerOpacity()})`,
        validateInput: (value) => {
          if (!isValidCssColor(value)) {
            return '有効なカラーコード（#RRGGBB, rgba(...) など）を入力してください。';
          }
          return null;
        }
      });
      if (!customInput || !isValidCssColor(customInput)) {
        return;
      }
      chosenColorKey = customInput.trim();
    }

    applyColorToOffsets(editor.document, chosenColorKey, targetOffsets, context);
  });

  // =========================================================================
  // 機能2：1発で色を塗るダイレクトコマンド群
  // =========================================================================
  (Object.keys(PRESET_BASE_COLORS) as PresetColorKey[]).forEach((colorKey) => {
    registerCommand(`quickColor.${colorKey}`, () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      const offsets = getTargetOffsetRangesFromCursor(editor);
      if (offsets.length === 0) {
        vscode.window.setStatusBarMessage('着色する単語またはテキストを選択してください', 2500);
        return;
      }
      applyColorToOffsets(editor.document, colorKey, offsets, context);
    });
  });

  // =========================================================================
  // 機能3：消しゴムコマンド（選択範囲またはカーソル位置の背景色を消す）
  // =========================================================================
  registerCommand('eraseSelection', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    const doc = editor.document;
    const docKey = doc.uri.toString();
    const colorMap = documentHighlightMap.get(docKey);
    if (!colorMap) {
      return;
    }

    const eraseTargets: HighlightRange[] = [];
    for (const selection of editor.selections) {
      if (!selection.isEmpty) {
        eraseTargets.push({
          start: doc.offsetAt(selection.start),
          end: doc.offsetAt(selection.end)
        });
      } else {
        const cursorOffset = doc.offsetAt(selection.active);
        let foundHighlight: HighlightRange | null = null;

        for (const ranges of colorMap.values()) {
          for (const r of ranges) {
            if (r.start <= cursorOffset && cursorOffset <= r.end) {
              foundHighlight = r;
              break;
            }
          }
          if (foundHighlight) {
            break;
          }
        }

        if (foundHighlight) {
          eraseTargets.push(foundHighlight);
        } else {
          const wordRange = doc.getWordRangeAtPosition(selection.active);
          if (wordRange) {
            eraseTargets.push({
              start: doc.offsetAt(wordRange.start),
              end: doc.offsetAt(wordRange.end)
            });
          }
        }
      }
    }

    if (eraseTargets.length === 0) {
      return;
    }

    colorMap.forEach((ranges, colorKey) => {
      let updated = ranges;
      for (const eraser of eraseTargets) {
        const next: HighlightRange[] = [];
        for (const r of updated) {
          next.push(...subtractOffsetRange(r, eraser));
        }
        updated = next;
      }
      colorMap.set(colorKey, updated);
    });

    renderDecorations(doc);
    saveHighlights(context);
    vscode.window.setStatusBarMessage('ハイライトを消去しました。', 2000);
  });

  // =========================================================================
  // 機能4：マーカー間ジャンプ＆マーカー一覧表示
  // =========================================================================
  registerCommand('jumpToNext', () => {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      jumpToHighlight(editor, 'next');
    }
  });

  registerCommand('jumpToPrev', () => {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      jumpToHighlight(editor, 'prev');
    }
  });

  registerCommand('listHighlights', () => {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      showHighlightList(editor);
    }
  });

  // =========================================================================
  // 機能5：背景色クリア（指定色 / このファイル全消去 / 全ファイル全消去）
  // =========================================================================
  registerCommand('clearSpecificColor', () => {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      clearSpecificColor(editor, context);
    }
  });

  // このファイルのマーカーを全消去（Shift + Alt + 0 / Alt + C）
  registerCommand('clearCurrentColors', () => {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      clearCurrentDocumentColors(editor, context);
    }
  });

  // すべてのファイルのマーカーを全消去
  registerCommand('clearAllColors', () => {
    documentHighlightMap.clear();
    for (const editor of vscode.window.visibleTextEditors) {
      renderDecorations(editor.document);
    }
    saveHighlights(context);
    vscode.window.setStatusBarMessage('すべてのファイルのハイライトをクリアしました。', 2500);
  });

  context.subscriptions.push(
    statusBarItem,
    changeDocumentListener,
    activeEditorListener,
    visibleEditorsListener,
    renameFilesListener,
    deleteFilesListener,
    configListener
  );
}

export function deactivate() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  if (extensionContext) {
    saveHighlights(extensionContext);
  }
  decorationTypes.forEach(decType => decType.dispose());
  decorationTypes.clear();
  documentHighlightMap.clear();
  undoClearBackupMap.clear();
}
