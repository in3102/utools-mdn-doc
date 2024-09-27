const fs = require('fs')
const path = require('path')
const mdn = require('./lib/mdn.js')
const utils = require('./lib/utils.js')
async function main() {
	const argv = process.argv.slice(2)
	const docCategory = argv[0]
	/**
	 * @type {UrlItem[]}
	 */
	let refrences = []
	try {
		refrences = await mdn.getDocRefrence(docCategory)
	} catch (e) {
		console.error(e)
		return
	}
	console.log('📚', '共计 ' + refrences.length + ' 篇有效文档')

	const indexPath = path.join(__dirname, 'public', docCategory, 'docs')
	if (!fs.existsSync(indexPath)) {
		fs.mkdirSync(indexPath)
	}
	//所有网址转小写,对比使用
	const lowerSrcArray = refrences.map((x) => x.src.toLowerCase())

	/**
	 * @type {utils.ArticleInfo[]}
	 */
	let indexes = []

	const lenStrLen = String(refrences.length).length
	for (let i = 0; i < refrences.length; i++) {
		const logStart = `[${String(i + 1).padStart(lenStrLen, '0')}/${refrences.length}]`
		const item = refrences[i]
		try {
			let articleInfo = await mdn.getArticle(item, docCategory, lowerSrcArray)
			indexes.push(articleInfo)
		} catch (e) {
			utils.printClearLine()
			console.log(`${logStart} 💢 ${e.message}`)
			continue
		}
		utils.printCurrrLine(`${logStart} ✅ ${item.src}`)
	}
	utils.printClearLine()
	const indexesFilePath = path.join(__dirname, 'public', docCategory, 'indexes.json')
	fs.writeFileSync(indexesFilePath, JSON.stringify(indexes))
	fs.copyFileSync(path.join(__dirname, 'doc.css'), path.join(__dirname, 'public', docCategory, 'docs', 'doc.css'))
	utils.copyFolder(path.join(__dirname, 'images'), path.join(__dirname, 'public', docCategory, 'docs', 'images'))
	await utils.updateReadMe(docCategory, indexes)

	console.log('--------  😁 全部完成,共计' + indexes.length + '篇文档 --------')
	process.exit(0)
}
// async function test() {
// 	// const r = await mdn.getCatalogue('/en-US/docs/Web/API/CSS_Object_Model', 'API')
// 	const r=await mdn.getArticle({src:'/docs/Web/HTML/Element/p',title:'p',language:'zh-CN'},'API',[])
// 	// /zh-CN/docs/Web/HTML/Element/p
// 	console.log(r)
// }
// test()
main()
