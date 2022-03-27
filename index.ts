import prompt from 'prompt'
import fs from 'fs-extra'
import screenshot from 'screenshot-desktop'
import sharp from 'sharp'
import { mouse, Point } from '@nut-tree/nut-js'

const SONG_DURATION_IN_MINUTES = 5

interface CalibrationSettings {
	leftMostKeyPosition: Point
	rightMostKeyPosition: Point
	cSharpKeyPosition: Point
	numOfKeys: number
}

function getPixel(buffer: Buffer, x: number, y: number, width: number): { r: number; g: number; b: number } {
	const pixelOffset = width * y + x
	return {
		r: buffer[pixelOffset * 3],
		g: buffer[pixelOffset * 3 + 1],
		b: buffer[pixelOffset * 3 + 2],
	}
}

function setPixel(buffer: Buffer, x: number, y: number, width: number, color: { r: number; g: number; b: number }): void {
	const pixelOffset = width * y + x
	buffer[pixelOffset * 3] = 255
	buffer[pixelOffset * 3 + 1] = 0
	buffer[pixelOffset * 3 + 2] = 255
}

/**
 * Workaround for a bug in the nut-js package: https://github.com/nut-tree/libnut/pull/59
 */
async function getMousePosition(): Promise<Point> {
	const mousePosition = await mouse.getPosition()
	return {
		...mousePosition,
		x: Math.round(mousePosition.x),
		y: Math.round(mousePosition.y),
	}
}

async function fetchNewCalibrationSettings(): Promise<CalibrationSettings> {
	await prompt.get([
		{
			name: 'leftMostKey',
			description: 'Hover over the [vertical top, horizontal center] of the left most key with the mouse and press enter',
			required: false,
		},
	])
	const leftMostKeyPosition = await getMousePosition()

	await prompt.get([
		{
			name: 'rightMostKey',
			description: 'Hover over the [vertical top, horizontal center] of the right most key with the mouse and press enter',
			required: false,
		},
	])
	const rightMostKeyPosition = await getMousePosition()

	await prompt.get([
		{
			name: 'cSharpKey',
			description: 'Hover over the [vertical top, horizontal center] of the C# (do) key with the mouse and press enter',
			required: false,
		},
	])
	const cSharpKeyPosition = await getMousePosition()

	const { numOfKeys } = (await prompt.get([
		{
			name: 'numOfKeys',
			description: 'How many keys does the keyboard have in total?',
			type: 'integer',
			required: false,
			default: '68', // 72,
		},
	])) as { numOfKeys: number }

	return {
		leftMostKeyPosition,
		rightMostKeyPosition,
		cSharpKeyPosition,
		numOfKeys,
	}
}

async function calibrateKeyboard(): Promise<CalibrationSettings> {
	prompt.start()

	let useSameAsLast = false
	let leftMostKeyPosition: { x: number; y: number }
	let rightMostKeyPosition: { x: number; y: number }
	let cSharpKeyPosition: { x: number; y: number }
	let numOfKeys: number

	if (await fs.pathExists('./last-settings.json')) {
		const response = (await prompt.get([
			{
				name: 'sameAsLastAnswer',
				description: 'Use the same settings as last time? Y/n',
				type: 'string',
				required: false,
				default: 'Y',
			},
		])) as { sameAsLastAnswer: string }
		useSameAsLast = response.sameAsLastAnswer !== 'n'
	}

	if (useSameAsLast) {
		console.log('Loading previous settings...')
		const lastSettings: CalibrationSettings = await fs.readJson('./last-settings.json')
		leftMostKeyPosition = lastSettings.leftMostKeyPosition
		rightMostKeyPosition = lastSettings.rightMostKeyPosition
		cSharpKeyPosition = lastSettings.cSharpKeyPosition
		numOfKeys = lastSettings.numOfKeys
	} else {
		const settings: CalibrationSettings = await fetchNewCalibrationSettings()
		leftMostKeyPosition = settings.leftMostKeyPosition
		rightMostKeyPosition = settings.rightMostKeyPosition
		cSharpKeyPosition = settings.cSharpKeyPosition
		numOfKeys = settings.numOfKeys

		await fs.writeJson('./last-settings.json', settings)
	}

	return {
		leftMostKeyPosition,
		rightMostKeyPosition,
		cSharpKeyPosition,
		numOfKeys,
	}
}

async function captureMidiData(settings: CalibrationSettings): Promise<boolean[][]> {
	return new Promise<boolean[][]>(async (resolve) => {
		const leftMostKeyPosition: { x: number; y: number } = settings.leftMostKeyPosition
		const rightMostKeyPosition: { x: number; y: number } = settings.rightMostKeyPosition
		const numOfKeys: number = settings.numOfKeys

		const verticalPositionY: number = Math.round((leftMostKeyPosition.y + rightMostKeyPosition.y) / 2)

		const horizontalPositionsX: number[] = []
		const pianoWidth = rightMostKeyPosition.x - leftMostKeyPosition.x

		for (let i = 0; i < numOfKeys; i++) {
			horizontalPositionsX.push(Math.round(leftMostKeyPosition.x + (i * pianoWidth) / (numOfKeys - 1)))
		}

		console.log('Ready to play the video...')
		const screen = await screenshot({ format: 'jpg' })
		const sharpImg = await sharp(screen)

		// Get image width
		const meta = await sharpImg.metadata()
		const width = meta.width as number
		// const height = meta.height as number

		// // Write detection positions to image
		// const buffer = await sharpImg.raw().toBuffer()
		// horizontalPositionsX.forEach((keyPositionX) => {
		// 	setPixel(buffer, keyPositionX, verticalPositionY, width, { r: 255, g: 0, b: 255 })
		// })
		// await sharp(buffer, { raw: { width, channels: 3, height } })
		// 	.jpeg()
		// 	.toFile('detection-points.jpg')

		const keyActivations: boolean[][] = []
		const epsilon = 40 // If one of the color components (r,g,b) is different from the average, the key is colored, instead of black or white

		const timerId = setInterval(async () => {
			// First capture a screenshot of a section of the screen.
			const screen = await screenshot({ format: 'jpg' })
			const buffer = await sharp(screen).raw().toBuffer()

			// Calculate color for each piano key
			const keyColors: { r: number; g: number; b: number }[] = []
			horizontalPositionsX.forEach((keyPositionX, index) => {
				keyColors[index] = getPixel(buffer, keyPositionX, verticalPositionY, width)
			})

			const keyActivation = keyColors.map((color): boolean => {
				const average = (color.r + color.g + color.b) / 3
				return Math.abs(color.r - average) > epsilon || Math.abs(color.g - average) > epsilon || Math.abs(color.b - average) > epsilon
			})
			// console.log(keyActivation.map((isKeyActive) => (isKeyActive ? '❎' : '_')).join(''))
			keyActivations.push(keyActivation)
		}, 50)

		setTimeout(async () => {
			clearInterval(timerId)
			await fs.writeJson('./midi-capture.json', keyActivations)
			console.log('Finished capture, wrote results to midi-capture.json')
			resolve(keyActivations)
		}, SONG_DURATION_IN_MINUTES * 60 * 1000 * 4 + 30 * 1000) // 5 minutes at 0.25x speed + 30 sec margin
	})
}

type NoteIndex = number
type LineIndex = number

async function convertCapturedDataToMidi(midiData: boolean[][]) {
	let passedInitialBlanks = false
	const notes: { noteIndex: NoteIndex; startIndex: LineIndex; endIndex: LineIndex }[] = []
	const activeNotes: Record<NoteIndex, LineIndex> = {}
	midiData.forEach((line: boolean[], lineIndex: LineIndex) => {
		// Skip initial silence
		if (line.find((entry) => entry) && !passedInitialBlanks) {
			passedInitialBlanks = true
		}

		if (passedInitialBlanks) {
			line.forEach((isActive: boolean, noteIndex: NoteIndex) => {
				if (!activeNotes[noteIndex] && isActive) {
					// Note started playing => add to active notes
					activeNotes[noteIndex] = lineIndex
				} else if (activeNotes[noteIndex] && !isActive) {
					// Note stopped playing => add to notes-list
					notes.push({
						noteIndex,
						startIndex: activeNotes[noteIndex],
						endIndex: lineIndex - 1,
					})
					delete activeNotes[noteIndex]
				}
			})
		}
	})

	console.log(notes)
}

let midiData: boolean[][]
if (!(await fs.pathExists('./midi-capture.json'))) {
	const settings: CalibrationSettings = await calibrateKeyboard()
	midiData = await captureMidiData(settings)
} else {
	midiData = await fs.readJson('./midi-capture.json')
}

const midiBuffer = convertCapturedDataToMidi(midiData)
