const fs = require('fs');
const path = require('path');
const assert = require('assert');
const {JSDOM} = require('jsdom');
const {VM} = require('./yomichan-vm');


// DOMRect class definition
class DOMRect {
    constructor(x, y, width, height) {
        this._x = x;
        this._y = y;
        this._width = width;
        this._height = height;
    }

    get x() { return this._x; }
    get y() { return this._y; }
    get width() { return this._width; }
    get height() { return this._height; }
    get left() { return this._x + Math.min(0, this._width); }
    get right() { return this._x + Math.max(0, this._width); }
    get top() { return this._y + Math.min(0, this._height); }
    get bottom() { return this._y + Math.max(0, this._height); }
}


function createJSDOM(fileName) {
    const domSource = fs.readFileSync(fileName, {encoding: 'utf8'});
    const dom = new JSDOM(domSource);
    const document = dom.window.document;
    const window = dom.window;

    // Define innerText setter as an alias for textContent setter
    Object.defineProperty(window.HTMLDivElement.prototype, 'innerText', {
        set(value) { this.textContent = value; }
    });

    // Placeholder for feature detection
    document.caretRangeFromPoint = () => null;

    return dom;
}

function querySelectorChildOrSelf(element, selector) {
    return selector ? element.querySelector(selector) : element;
}

function getChildTextNodeOrSelf(dom, node) {
    if (node === null) { return null; }
    const Node = dom.window.Node;
    const childNode = node.firstChild;
    return (childNode !== null && childNode.nodeType === Node.TEXT_NODE ? childNode : node);
}

function getPrototypeOfOrNull(value) {
    try {
        return Object.getPrototypeOf(value);
    } catch (e) {
        return null;
    }
}

function findImposterElement(document) {
    // Finds the imposter element based on it's z-index style
    return document.querySelector('div[style*="2147483646"]>*');
}


async function testDocument1() {
    const dom = createJSDOM(path.join(__dirname, 'data', 'html', 'test-document1.html'));
    const window = dom.window;
    const document = window.document;
    const Node = window.Node;
    const Range = window.Range;

    const vm = new VM({document, window, Range, Node});
    vm.execute([
        'mixed/js/dom.js',
        'fg/js/source.js',
        'fg/js/document.js'
    ]);
    const [TextSourceRange, TextSourceElement, docRangeFromPoint, docSentenceExtract] = vm.get([
        'TextSourceRange',
        'TextSourceElement',
        'docRangeFromPoint',
        'docSentenceExtract'
    ]);

    try {
        await testDocumentTextScanningFunctions(dom, {docRangeFromPoint, docSentenceExtract, TextSourceRange, TextSourceElement});
        await testTextSourceRangeSeekFunctions(dom, {TextSourceRange});
    } finally {
        window.close();
    }
}

async function testDocumentTextScanningFunctions(dom, {docRangeFromPoint, docSentenceExtract, TextSourceRange, TextSourceElement}) {
    const document = dom.window.document;

    for (const testElement of document.querySelectorAll('.test[data-test-type=scan]')) {
        // Get test parameters
        let {
            elementFromPointSelector,
            caretRangeFromPointSelector,
            startNodeSelector,
            startOffset,
            endNodeSelector,
            endOffset,
            resultType,
            sentenceExtent,
            sentence,
            hasImposter
        } = testElement.dataset;

        const elementFromPointValue = querySelectorChildOrSelf(testElement, elementFromPointSelector);
        const caretRangeFromPointValue = querySelectorChildOrSelf(testElement, caretRangeFromPointSelector);
        const startNode = getChildTextNodeOrSelf(dom, querySelectorChildOrSelf(testElement, startNodeSelector));
        const endNode = getChildTextNodeOrSelf(dom, querySelectorChildOrSelf(testElement, endNodeSelector));

        startOffset = parseInt(startOffset, 10);
        endOffset = parseInt(endOffset, 10);
        sentenceExtent = parseInt(sentenceExtent, 10);

        assert.notStrictEqual(elementFromPointValue, null);
        assert.notStrictEqual(caretRangeFromPointValue, null);
        assert.notStrictEqual(startNode, null);
        assert.notStrictEqual(endNode, null);

        // Setup functions
        document.elementFromPoint = () => elementFromPointValue;

        document.caretRangeFromPoint = (x, y) => {
            const imposter = getChildTextNodeOrSelf(dom, findImposterElement(document));
            assert.strictEqual(!!imposter, hasImposter === 'true');

            const range = document.createRange();
            range.setStart(imposter ? imposter : startNode, startOffset);
            range.setEnd(imposter ? imposter : startNode, endOffset);

            // Override getClientRects to return a rect guaranteed to contain (x, y)
            range.getClientRects = () => [new DOMRect(x - 1, y - 1, 2, 2)];
            return range;
        };

        // Test docRangeFromPoint
        const source = docRangeFromPoint(0, 0, false);
        switch (resultType) {
            case 'TextSourceRange':
                assert.strictEqual(getPrototypeOfOrNull(source), TextSourceRange.prototype);
                break;
            case 'TextSourceElement':
                assert.strictEqual(getPrototypeOfOrNull(source), TextSourceElement.prototype);
                break;
            case 'null':
                assert.strictEqual(source, null);
                break;
            default:
                assert.ok(false);
                break;
        }
        if (source === null) { continue; }

        // Test docSentenceExtract
        const sentenceActual = docSentenceExtract(source, sentenceExtent).text;
        assert.strictEqual(sentenceActual, sentence);

        // Clean
        source.cleanup();
    }
}

async function testTextSourceRangeSeekFunctions(dom, {TextSourceRange}) {
    const document = dom.window.document;

    for (const testElement of document.querySelectorAll('.test[data-test-type=text-source-range-seek]')) {
        // Get test parameters
        let {
            seekNodeSelector,
            seekNodeIsText,
            seekOffset,
            seekLength,
            seekDirection,
            expectedResultNodeSelector,
            expectedResultNodeIsText,
            expectedResultOffset,
            expectedResultContent
        } = testElement.dataset;

        seekOffset = parseInt(seekOffset, 10);
        seekLength = parseInt(seekLength, 10);
        expectedResultOffset = parseInt(expectedResultOffset, 10);

        let seekNode = testElement.querySelector(seekNodeSelector);
        if (seekNodeIsText === 'true') {
            seekNode = seekNode.firstChild;
        }

        let expectedResultNode = testElement.querySelector(expectedResultNodeSelector);
        if (expectedResultNodeIsText === 'true') {
            expectedResultNode = expectedResultNode.firstChild;
        }

        const {node, offset, content} = (
            seekDirection === 'forward' ?
            TextSourceRange.seekForward(seekNode, seekOffset, seekLength) :
            TextSourceRange.seekBackward(seekNode, seekOffset, seekLength)
        );

        assert.strictEqual(node, expectedResultNode);
        assert.strictEqual(offset, expectedResultOffset);
        assert.strictEqual(content, expectedResultContent);
    }
}


async function main() {
    await testDocument1();
}


if (require.main === module) { main(); }