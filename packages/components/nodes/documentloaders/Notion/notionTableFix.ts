import { getBlockChildren } from 'notion-to-md/build/utils/notion.js'

/**
 * Overrides the default table block handler on a NotionAPILoader instance
 * to produce compact markdown tables without the excessive cell padding
 * added by the markdown-table library's default options.
 */
export function applyCompactTableTransformer(loader: any) {
    const n2m = loader.n2mClient
    const notionClient = loader.notionClient

    n2m.setCustomTransformer('table', async (block: any) => {
        const { id, has_children } = block

        if (!has_children) return ''

        const tableRows = await getBlockChildren(notionClient, id, 100)
        const tableArr = await Promise.all(
            (tableRows || []).map(async (row: any) => {
                const { type } = row
                const cells = row[type]['cells']
                return await Promise.all(
                    cells.map(async (cell: any) =>
                        (
                            await n2m.blockToMarkdown({
                                type: 'paragraph',
                                paragraph: { rich_text: cell }
                            })
                        )
                            .trim()
                            .replace(/\n/g, ' ')
                    )
                )
            })
        )

        if (tableArr.length === 0) return ''

        const header = '| ' + tableArr[0].join(' | ') + ' |'
        const separator = '| ' + tableArr[0].map(() => '---').join(' | ') + ' |'
        const rows = tableArr.slice(1).map((row) => '| ' + row.join(' | ') + ' |')
        return [header, separator, ...rows].join('\n')
    })
}
