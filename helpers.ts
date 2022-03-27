import { mouse, Point } from '@nut-tree/nut-js'
import { CalibrationSettings } from './types'

export function getPixel(buffer: Buffer, x: number, y: number, width: number): { r: number; g: number; b: number } {
	const pixelOffset = width * y + x
	return {
		r: buffer[pixelOffset * 3],
		g: buffer[pixelOffset * 3 + 1],
		b: buffer[pixelOffset * 3 + 2],
	}
}

export function setPixel(buffer: Buffer, x: number, y: number, width: number, color: { r: number; g: number; b: number }): void {
	const pixelOffset = width * y + x
	buffer[pixelOffset * 3] = 255
	buffer[pixelOffset * 3 + 1] = 0
	buffer[pixelOffset * 3 + 2] = 255
}

/**
 * Workaround for a bug in the nut-js package: https://github.com/nut-tree/libnut/pull/59
 */
export async function getMousePosition(): Promise<Point> {
	const mousePosition = await mouse.getPosition()
	return {
		...mousePosition,
		x: Math.round(mousePosition.x),
		y: Math.round(mousePosition.y),
	}
}

export function getKeyPositionsFromSettings(settings: CalibrationSettings): { verticalPositionY: number; horizontalPositionsX: number[] } {
	const { leftMostKeyPosition, rightMostKeyPosition, numOfKeys } = settings
	const verticalPositionY: number = Math.round((leftMostKeyPosition.y + rightMostKeyPosition.y) / 2)

	const horizontalPositionsX: number[] = []
	const pianoWidth = rightMostKeyPosition.x - leftMostKeyPosition.x

	for (let i = 0; i < numOfKeys; i++) {
		horizontalPositionsX.push(Math.round(leftMostKeyPosition.x + (i * pianoWidth) / (numOfKeys - 1)))
	}

	return {
		verticalPositionY,
		horizontalPositionsX,
	}
}

export function findClosestIndex(value: number, arr: number[]): number {
	let minimalDiff = Number.MAX_SAFE_INTEGER
	let minimalDiffIndex = -1

	arr.forEach((arrValue, arrValueIndex) => {
		const diff = Math.abs(arrValue - value)
		if (diff < minimalDiff) {
			minimalDiff = diff
			minimalDiffIndex = arrValueIndex
		}
	})

	return minimalDiffIndex
}
