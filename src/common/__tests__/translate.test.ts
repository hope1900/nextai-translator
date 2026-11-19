import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IMessageRequest } from '../engines/interfaces'
import { Action } from '../internal-services/db'
import { getLangConfig, LangCode } from '../lang'
import { QuoteProcessor, translate } from '../translate'

const { capturedRequests } = vi.hoisted(() => ({
    capturedRequests: [] as IMessageRequest[],
}))

vi.mock('../utils', () => ({
    getSettings: vi.fn(async () => ({
        provider: 'OpenAI',
        claudeThinking: false,
        claudeThinkingLevel: 'medium',
    })),
}))

vi.mock('../perf', () => ({
    ensurePerfTrace: vi.fn(),
    markPerf: vi.fn(),
    setPerfMeta: vi.fn(),
}))

vi.mock('../engines', () => ({
    getEngine: vi.fn(() => ({
        sendMessage: vi.fn(async (req: IMessageRequest) => {
            capturedRequests.push(req)
            await req.onMessage({
                content: 'mocked translation',
                role: 'assistant',
            })
            req.onFinished('stop')
        }),
    })),
}))

describe('QuoteProcessor', () => {
    it('should return the string without quote', () => {
        const quoteProcessor = new QuoteProcessor()
        const deltas = [
            ...quoteProcessor.quoteStart.split(''),
            'T',
            'h',
            'i',
            's',
            ' ',
            'i',
            's',
            ' ',
            'a',
            ' ',
            't',
            'e',
            's',
            't',
            '.',
            ...quoteProcessor.quoteEnd.split(''),
        ]

        let targetText = ''
        for (const delta of deltas) {
            targetText += quoteProcessor.processText(delta)
        }

        expect(targetText).toEqual('This is a test.')
    })

    it('should return the string without quote', () => {
        const quoteProcessor = new QuoteProcessor()
        const deltas = [
            ...quoteProcessor.quoteStart.split(''),
            'T',
            'h',
            'i',
            's',
            ' ',
            'i',
            's',
            ' ',
            'a',
            ' ',
            't',
            'e',
            's',
            't',
            '.',
            '(',
            ')' + quoteProcessor.quoteEnd.split('')[0],
            ...quoteProcessor.quoteEnd.split('').slice(1),
        ]

        let targetText = ''
        for (const delta of deltas) {
            targetText += quoteProcessor.processText(delta)
        }

        expect(targetText).toEqual('This is a test.()')
    })

    it('should return the string without quote', () => {
        const quoteProcessor = new QuoteProcessor()
        const text = 'This is a test.'
        const targetText = quoteProcessor.processText(quoteProcessor.quoteStart + text + quoteProcessor.quoteEnd)
        expect(targetText).toEqual(text)
    })

    it('should return the string without quote', () => {
        const quoteProcessor = new QuoteProcessor()
        const text = 'This is a test.'
        const targetText = quoteProcessor.processText(
            `${quoteProcessor.quoteStart}This${quoteProcessor.quoteStart} is ${quoteProcessor.quoteEnd}a${quoteProcessor.quoteStart} test.${quoteProcessor.quoteEnd}`
        )
        expect(targetText).toEqual(text)
    })

    it('should return the same string if no quote exists', () => {
        const quoteProcessor = new QuoteProcessor()
        const deltas = [
            '<X',
            '1',
            '2',
            'Y>',
            'T',
            'h',
            'i',
            's',
            ' ',
            'i',
            's',
            ' ',
            'a',
            ' ',
            't',
            'e',
            's',
            't',
            '.',
            '</',
            'X',
            '1',
            '2',
            'Y>',
        ]
        let targetText = ''
        for (const delta of deltas) {
            targetText += quoteProcessor.processText(delta)
        }

        expect(targetText).toEqual('<X12Y>This is a test.</X12Y>')
    })

    it('should return the same string if no quote exists', () => {
        const quoteProcessor = new QuoteProcessor()
        const text = '<X12Y>This is a test.</X12Y>'
        const targetText = quoteProcessor.processText(text)
        expect(targetText).toEqual(text)
    })

    it('should return the same string if no quote exists', () => {
        const quoteProcessor = new QuoteProcessor()
        const text = `This is${quoteProcessor.quoteStart.slice(0, quoteProcessor.quoteStart.length - 1)} a test.`
        const targetText = quoteProcessor.processText(text)
        expect(targetText).toEqual(text)
    })

    it('do not remove the sub part of quote', () => {
        const quoteProcessor = new QuoteProcessor()
        const text = `This is${quoteProcessor.quoteStart.slice(0, quoteProcessor.quoteStart.length - 1)} a test.`
        const targetText = quoteProcessor.processText(quoteProcessor.quoteStart + text + quoteProcessor.quoteEnd)
        expect(targetText).toEqual(text)
    })

    it('do not remove the sub part of quote', () => {
        const quoteProcessor = new QuoteProcessor()
        const text = `This is${quoteProcessor.quoteEnd.slice(0, quoteProcessor.quoteEnd.length - 1)} a test.`
        const targetText = quoteProcessor.processText(quoteProcessor.quoteStart + text + quoteProcessor.quoteEnd)
        expect(targetText).toEqual(text)
    })

    it('do not remove the sub part of quote', () => {
        const quoteProcessor = new QuoteProcessor()
        const text = `This is${quoteProcessor.quoteStart.slice(
            0,
            quoteProcessor.quoteStart.length - 1
        )} a${quoteProcessor.quoteStart.slice(
            0,
            quoteProcessor.quoteStart.length - 2
        )} te${quoteProcessor.quoteEnd.slice(0, quoteProcessor.quoteEnd.length - 1)}st${quoteProcessor.quoteEnd.slice(
            0,
            quoteProcessor.quoteEnd.length - 2
        )}.`
        const targetText = quoteProcessor.processText(quoteProcessor.quoteStart + text + quoteProcessor.quoteEnd)
        expect(targetText).toEqual(text)
    })
})

function createAction(): Action {
    return {
        idx: 0,
        mode: 'translate',
        name: 'Translate',
        updatedAt: '2026-01-01T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
    }
}

async function runTranslate(params: {
    text: string
    detectFrom: LangCode
    detectTo: LangCode
    writing?: boolean
    selectedWord?: string
}) {
    const controller = new AbortController()
    let isWordMode = false
    await translate({
        text: params.text,
        detectFrom: params.detectFrom,
        detectTo: params.detectTo,
        writing: params.writing,
        selectedWord: params.selectedWord,
        mode: 'translate',
        action: createAction(),
        signal: controller.signal,
        onMessage: async (message) => {
            isWordMode = message.isWordMode
        },
        onError: vi.fn(),
        onFinish: vi.fn(),
    })
    return {
        request: capturedRequests[capturedRequests.length - 1],
        isWordMode,
    }
}

describe('translate', () => {
    beforeEach(() => {
        capturedRequests.length = 0
    })

    it('uses Chinese-to-foreign short word prompt and keeps isWordMode false for Chinese words', async () => {
        const { request, isWordMode } = await runTranslate({
            text: '音标',
            detectFrom: 'zh-Hans',
            detectTo: 'en',
        })

        expect(isWordMode).toBe(false)
        expect(request.rolePrompt).toContain('翻译成English')
        expect(request.rolePrompt).toContain('<序号>. <English单词或短语> · /<IPA>/')
        expect(request.rolePrompt).toContain('例句：<English例句>(<中文翻译>)')
        expect(request.rolePrompt).not.toContain('<word> (<original form>)')
        expect(request.rolePrompt).not.toContain('/ <')
        expect(request.commandPrompt).toBe('Only reply the result and nothing else. 请将以下中文翻译成English:\n\n音标')
    })

    it('handles Chinese idioms and trimmed short words in Chinese-to-foreign mode', async () => {
        const idiomResult = await runTranslate({
            text: '画蛇添足',
            detectFrom: 'zh-Hans',
            detectTo: 'en',
        })
        expect(idiomResult.isWordMode).toBe(false)
        expect(idiomResult.request.rolePrompt).toContain('<序号>. <English单词或短语> · /<IPA>/')
        expect(idiomResult.request.commandPrompt).toContain('\n\n画蛇添足')

        const paddedResult = await runTranslate({
            text: '  音标  ',
            detectFrom: 'zh-Hans',
            detectTo: 'en',
        })
        expect(paddedResult.isWordMode).toBe(false)
        expect(paddedResult.request.rolePrompt).toContain('<序号>. <English单词或短语> · /<IPA>/')
        expect(paddedResult.request.commandPrompt).toBe(
            'Only reply the result and nothing else. 请将以下中文翻译成English:\n\n音标'
        )
    })

    it('uses standard translation prompt for longer Chinese sentences', async () => {
        const { request, isWordMode } = await runTranslate({
            text: '今天天气真不错，我想出去散步。',
            detectFrom: 'zh-Hans',
            detectTo: 'en',
        })

        expect(isWordMode).toBe(false)
        expect(request.rolePrompt).not.toContain('<序号>. <English单词或短语>')
        expect(request.rolePrompt).not.toContain('<word> (<original form>)')
        expect(request.commandPrompt).toContain('Only reply the result and nothing else.')
        expect(request.commandPrompt).toContain('今天天气真不错，我想出去散步。')
    })

    it('does not hijack Chinese-to-Chinese single words into dictionary word mode', async () => {
        const { request, isWordMode } = await runTranslate({
            text: '音标',
            detectFrom: 'zh-Hans',
            detectTo: 'zh-Hant',
        })

        expect(isWordMode).toBe(false)
        expect(request.rolePrompt).not.toContain('<word> (<original form>)')
        expect(request.rolePrompt).not.toContain('<单词>')
        expect(request.rolePrompt).not.toContain('<序号>. <Traditional Chinese单词或短语>')
    })

    it('uses source phonetic notation and fixed format for foreign word to Chinese', async () => {
        const { request, isWordMode } = await runTranslate({
            text: 'hello',
            detectFrom: 'en',
            detectTo: 'zh-Hans',
        })

        expect(isWordMode).toBe(true)
        expect(request.rolePrompt).toContain('[<语种>] · /<IPA>/')
        expect(request.rolePrompt).not.toContain('Pinyin')
        expect(request.rolePrompt).toContain('[<词性缩写>] <中文含义>')
        expect(request.rolePrompt).not.toContain('<中文含义>]')
        expect(request.commandPrompt).toBe('Only reply the result and nothing else.\n\n单词是：hello')
    })

    it('uses English language names and closing slash for foreign-to-foreign words', async () => {
        const frPhonetic = getLangConfig('fr').phoneticNotation
        expect(frPhonetic).toBeTruthy()

        const { request, isWordMode } = await runTranslate({
            text: 'bonjour',
            detectFrom: 'fr',
            detectTo: 'en',
        })

        expect(isWordMode).toBe(true)
        expect(request.rolePrompt).toContain('French-English dictionary')
        expect(request.rolePrompt).toContain(`[<language>] · /<${frPhonetic}>/`)
        expect(request.rolePrompt).not.toContain('Français')
        expect(request.commandPrompt).toBe('Only reply the result and nothing else.\n\nThe word is: bonjour')
    })

    it('omits phonetic markers when the relevant language has no phoneticNotation', async () => {
        expect(getLangConfig('vi').phoneticNotation).toBeFalsy()

        const fromVietnamese = await runTranslate({
            text: 'xin',
            detectFrom: 'vi',
            detectTo: 'en',
        })
        expect(fromVietnamese.isWordMode).toBe(true)
        expect(fromVietnamese.request.rolePrompt).not.toContain('false')
        expect(fromVietnamese.request.rolePrompt).toContain('[<language>]\n')

        const toVietnamese = await runTranslate({
            text: '音标',
            detectFrom: 'zh-Hans',
            detectTo: 'vi',
        })
        expect(toVietnamese.isWordMode).toBe(false)
        expect(toVietnamese.request.rolePrompt).not.toContain('false')
        expect(toVietnamese.request.rolePrompt).toContain('<序号>. <Vietnamese单词或短语>\n')
    })

    it('uses English language names and keeps isWordMode false for selectedWord', async () => {
        const { request, isWordMode } = await runTranslate({
            text: '学习音标很重要',
            detectFrom: 'zh-Hans',
            detectTo: 'en',
            selectedWord: '音标',
        })

        expect(isWordMode).toBe(false)
        expect(request.rolePrompt).toContain('Simplified Chinese language')
        expect(request.rolePrompt).toContain('explain in English')
        expect(request.rolePrompt).toContain('<word> · /<Pinyin>/')
        expect(request.rolePrompt).not.toContain('简体中文')
        expect(request.rolePrompt).not.toContain('say "yes"')
        expect(request.commandPrompt).toBe(
            'Only reply the result and nothing else.\n\nthe sentence is: 学习音标很重要\n\nthe word is: 音标'
        )
    })

    it('keeps writing mode on standard translation prompt', async () => {
        const { request, isWordMode } = await runTranslate({
            text: '音标',
            detectFrom: 'zh-Hans',
            detectTo: 'en',
            writing: true,
        })

        expect(isWordMode).toBe(false)
        expect(request.rolePrompt).not.toContain('<序号>. <English单词或短语>')
        expect(request.rolePrompt).not.toContain('<word> (<original form>)')
    })
})
