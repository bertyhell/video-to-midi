import { Point } from '@nut-tree/nut-js'

export interface CalibrationSettings {
	leftMostKeyPosition: Point
	rightMostKeyPosition: Point
	c4KeyPosition: Point
	numOfKeys: number
}

export type NoteIndex = number
export type LineIndex = number
