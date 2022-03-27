import prompt from 'prompt'
import fs from 'fs-extra'
import screenshot from 'screenshot-desktop'
import sharp from 'sharp'
import { findClosestIndex, getKeyPositionsFromSettings, getMousePosition, getPixel } from './helpers.js'
import { CalibrationSettings, LineIndex, NoteIndex } from './types.js'
import MidiWriter, { Duration, Pitch } from 'midi-writer-js'
import Midi from '@tonaljs/midi'

const SONG_DURATION_IN_MINUTES = 5

const CAPTURE_RATE_TO_START_TICK_RATIO = 3
const CAPTURE_RATE_TO_NOTE_DURATION_RATIO = 3

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
		c4KeyPosition: cSharpKeyPosition,
		numOfKeys,
	}
}

async function calibrateKeyboard(): Promise<CalibrationSettings> {
	prompt.start()

	let useSameAsLast = false
	let leftMostKeyPosition: { x: number; y: number }
	let rightMostKeyPosition: { x: number; y: number }
	let c4KeyPosition: { x: number; y: number }
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
		c4KeyPosition = lastSettings.c4KeyPosition
		numOfKeys = lastSettings.numOfKeys
	} else {
		const settings: CalibrationSettings = await fetchNewCalibrationSettings()
		leftMostKeyPosition = settings.leftMostKeyPosition
		rightMostKeyPosition = settings.rightMostKeyPosition
		c4KeyPosition = settings.c4KeyPosition
		numOfKeys = settings.numOfKeys

		await fs.writeJson('./last-settings.json', settings, { spaces: 2 })
	}

	return {
		leftMostKeyPosition,
		rightMostKeyPosition,
		c4KeyPosition: c4KeyPosition,
		numOfKeys,
	}
}

async function captureMidiData(settings: CalibrationSettings): Promise<boolean[][]> {
	return new Promise<boolean[][]>(async (resolve) => {
		const { verticalPositionY, horizontalPositionsX } = getKeyPositionsFromSettings(settings)

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
			console.log(keyActivation.map((isKeyActive) => (isKeyActive ? '❎' : '_')).join(''))
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

function convertCapturedDataToMidi(midiData: boolean[][], settings: CalibrationSettings): Uint8Array {
	// Convert keyboard activation data to notes with start and end times
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

	// Create midi file
	const track = new MidiWriter.Track()
	track.addEvent(new MidiWriter.ProgramChangeEvent({ instrument: 1 }))

	// Figure out which key is the C4 key
	const C4_MIDI_INDEX = 60 // https://www.inspiredacoustics.com/en/MIDI_note_numbers_and_center_frequencies
	const { horizontalPositionsX } = getKeyPositionsFromSettings(settings)
	const c4NoteIndex: number = findClosestIndex(settings.c4KeyPosition.x, horizontalPositionsX)
	const leftMostKeyMidiIndex = C4_MIDI_INDEX - c4NoteIndex

	notes.forEach((note) => {
		const noteEvent = new MidiWriter.NoteEvent({
			// Convert noteIndex (0 - 67) to pitch names ('C4', 'C#4', 'D4', ...)
			pitch: [Midi.midiToNoteName(leftMostKeyMidiIndex + note.noteIndex) as Pitch],
			duration: ('T' + (note.endIndex - note.startIndex) * CAPTURE_RATE_TO_NOTE_DURATION_RATIO) as Duration,
			startTick: note.startIndex * CAPTURE_RATE_TO_START_TICK_RATIO,
		})
		track.addEvent(noteEvent)
	})

	// Write midi file to disk
	const writer = new MidiWriter.Writer(track)
	return writer.buildFile()
}

let midiData: boolean[][]
let settings: CalibrationSettings

if (!(await fs.pathExists('./midi-capture.json'))) {
	settings = await calibrateKeyboard()
	midiData = await captureMidiData(settings)
} else {
	settings = await fs.readJson('./last-settings.json')
	midiData = await fs.readJson('./midi-capture.json')
}

const midiBuffer: Uint8Array = convertCapturedDataToMidi(midiData, settings)

await fs.writeFile('./song.mid', midiBuffer)
console.log('File song.mid written to disk')
