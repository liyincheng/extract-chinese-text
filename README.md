## Extract Chinese Text
A tool to extract Chinese or other unicode in special range and save as a CSV file for i18n or other usage.
```bash
npm install -g extract-chinese-text
extract-text \
    src/,index.vue,index.jsx \ # input source, file or directory, can be joined by ','
    --exclude=min.js\|plugins \ # [optional] some type of file want not to be processed
    --suffix=js,jsx,vue,html,json \ # [optional] file suffix to be processed
    --output=output.csv \ # [optional] output file location
    --range=\\uc4e00-\\u9fff # [optional] char range to be extracted in
```
It will extract all the Chinese charactor or specified range unicode from template content and attributes value of vue/jsx template and strings in js files.  
It bases on babel/parser to buid AST tree for js and hyntax for html. Then the script go through all the AST node to get the String type contains specified charactor and save to a CSV file. 
The output csv file looks like: 
```
file name   line no sourceType  text
index.vue   5   html    确定
index.vue   6   html    取消
index.vue   14  html    网络错误
content.js   18  html    掌握程度
```
