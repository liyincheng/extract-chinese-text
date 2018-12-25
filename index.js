#! /usr/bin/env node

const argv = require('optimist').argv;
const fs = require("fs");
const recursive = require('recursive-readdir');
const recast = require("recast");
// recast.types = require("ast-types").load("def/esprima.js")
const { tokenize, constructTree } = require('hyntax')
const util = require('util')
const Json2csvParser = require('json2csv').Parser;
// const htmlParser = require('rehype-parse');

if (process.argv.length === 2) {
    console.log(`extract-text \\
        src/,index.vue,index.jsx \\ # input source, file or directory, can be joined by ','
        --exclude=min.js\|plugins \\ # [optional] some type of file want not to be processed
        --suffix=js,jsx,vue,html,json \\ # [optional] file suffix to be processed
        --output=output.csv \\ # [optional] output file location
        --range=\\\\uc4e00-\\\\u9fff # [optional] char range to be extracted in`);
    return;
}
let path = process.argv[2] || './';
const suffixes = argv.suffix ? argv.suffix.split(',') : ['js', 'jsx', 'vue', 'html', 'json'];
let result = []; // 最后结果的json
let promiseJob = []; // 读取文件的promise
let output = argv.output || 'output.csv'; // 输出文件路径
!/\.csv$/.test(output) && (output += '.csv');
let exclude = null; // 排除路径正则
let charRange = argv.range || '\\u4e00-\\u9fff'; // 字符的unicode范围
let rangeRex = null;
try {
    rangeRex = new RegExp('[' + charRange + ']');
} catch (e) {
    console.error('Invalid chage range: ' + charRange);
}
try {
    argv.exclude && (exclude = new RegExp(argv.exclude));
} catch (e) {
    console.error('Invalid regular expression: ' + argv.exclude);
    return;
}
let successCount = 0,
    scriptFailedCount = 0,
    failedCount = 0;

let extractor = {
    extract (inputs) {
        inputs.split(',').forEach(input => {
            if (input) {
                promiseJob.push(extractor.extractAllFile(input));
            }
        });
        Promise.all(promiseJob).then(() => {
            console.log(`\nTotally processed ${successCount + failedCount} files, success: ${successCount}, failed: ${failedCount}`
                + ` (script failed: ${scriptFailedCount})\n`);
            const fields = ["file name", "line no", "source type", "text"];
            const parser = new Json2csvParser({ fields });
            const csv = parser.parse(result);
            // MS Office需要一个BOM信息，不然会乱码
            fs.writeFileSync('output.csv', new Buffer('\xEF\xBB\xBF','binary'));
            fs.writeFileSync('output.csv', csv, { encoding: 'utf-8', flag: 'a'});
        });
    },
    extractAllFile (input) {
        return new Promise (resolve => {
            if (fs.lstatSync(input).isDirectory()) {
                recursive(input, function (err, files) {
                    for (let i = 0; i < files.length; i++) {
                        extractor.extractFile(files[i]);
                    }
                    resolve();
                });
            } else {
                extractor.extractFile(input);
                resolve();
            }
        });
        // console.log(result);
    },
    extractFile (file) {
        let matches = file.match(/\.([^.]+)$/);
        if (!matches || !~suffixes.indexOf(matches[1])) {
            return;
        }
        if (exclude && exclude.test(file)) {
            return;
        }
        let suffix = matches[1];
        let content = fs.readFileSync(file, "utf8");
        if (suffix === 'json') {
            // 由于不支持json，所以变成一个变量
            content = 'var a = ' + content;
        }
        let success = ~['vue', 'html'].indexOf(suffix) ? extractor.parseHtml(content, file)
            : extractor.parseJS(content, file);
        success ? successCount++ : failedCount++;
        console.log('Process file ' + (success ? 'succeeded' : 'failed') + ': ' + file);
    },
    parseHtml (code, fileName) {
        // let ast = htmlParser.parse(code);
        // console.log(ast);
        try {
            const { tokens } = tokenize(code)
            const { ast } = constructTree(tokens)
            extractor.processHtmlNode(ast, code, fileName); 
        } catch (e) {
            return false;
        }
        return true;
        // console.log(JSON.stringify(tokens, null, 2))
        // console.log(util.inspect(ast, { showHidden: false, depth: null }))
    },
    saveToJSON (fileName, lineNo, sourceType, text) {
        // 检测如果有中文才写入
        if (rangeRex.test(text)) {
            result.push({
                'file name': fileName,
                'line no': lineNo,
                'text': text,
                'source type': sourceType
            });
        }
    },
    processHtmlNode (node, code, fileName) {
        if (node.nodeType === 'text') {
            let text = node.content.value.content || '';
            text = text.trim();
            if (text) {
                let lineNo = extractor._getLineNo(code, node);
                extractor.saveToJSON(fileName, lineNo, 'html', text);
            }
            // console.log(text);
        } else if (node.nodeType === 'tag') {
            node.content.attributes && node.content.attributes.forEach(attr => {
                if (attr.value) {
                    let lineNo = extractor._getLineNo(code, attr.value);
                    let text =  attr.value.content;
                    // console.log('line no = ' + lineNo + ' attr value = ' + attrValue);
                    extractor.saveToJSON(fileName, lineNo, 'html', text);
                }
            });
            // console.log(util.inspect(node, { showHidden: false, depth: null }));
        } else if (node.nodeType === 'script') {
            if (node.content.value) {
                let script = node.content.value.content;
                let lineNo = extractor._getLineNo(code, node) - 1;
                extractor.parseJS(script, fileName, lineNo);
            }
        }
        node.content.children && node.content.children.forEach(child => {
            extractor.processHtmlNode(child, code, fileName);
        });
    },
    _getLineNo (code, node) {
        let pos = node.startPosition || node.content.value.startPosition;
        return (code.substr(0, pos).match(/\r?\n/g) || []).length + 1;
    },
    parseJS (code, fileName, beginLine = 0) {
        let ast = null;
        try {
            // 由于不支持动态import这里把它remove掉
            code = code.replace(/import\([^)]+\)/g, '{}');
                    // 不支持展开运算符
                    // .replace(/\.\.\./g, '');
                    // 不支持static
            ast = recast.parse(code, {
                // parser: require('./esprima.js')
                parser: require("recast/parsers/babel")
            });
            // console.log(util.inspect(ast, { showHidden: false, depth: null }))
        } catch (e) {
            scriptFailedCount++;
            console.error('-------' + fileName + ': Parse JS AST Failed, may contain grammatical errors: -----');
            console.error(e);
            return false;
        }
        // console.log(ast.loc.tokens[0]);
        ast.loc.tokens.forEach(token => {
            if (token.type.label === 'string') {
                let lineNo = token.loc.start.line + beginLine;
                let text = (token.value || '').replace(/^'|'$/g, '');
                // console.log(text);
                extractor.saveToJSON(fileName, lineNo, 'js', text);
            }
        });
        return true;
        // console.log(ast);
    }
};

extractor.extract(path); 
