/**
 * Grouping of a project's images, videos and audio, with the images that shot renders output apart. The assets come from the
 * project state: every asset the current state holds, and every asset the project imported anywhere in its history,
 * each with this project's own import name and time and the operation that made it (`made_by`). A generated asset of a
 * step that an undo went back past is not listed; an imported asset always is.
 *
 * @module @dv/ui-asset-pool/library
 */
import { mediaTypeOf } from '@dv/ui-kit/media-type.ts'
import type { ProjectAsset, WireState } from '@dv/ui-kit/types.ts'

/** The panel's view of one project's assets: every image, video and audio file once, grouped, newest first. */
export interface AssetLibrary {
  /** Assets whose media type is `image/*`, except the images in `extracted`. */
  images: ProjectAsset[]
  /** Assets whose media type is `video/*`. */
  videos: ProjectAsset[]
  /** Images whose producer record (`created_by`) also output a video, such as the last frame of a rendered shot. */
  extracted: ProjectAsset[]
  /** Assets whose media type is `audio/*`, imported or made by an operation such as `audioedit.split`. */
  audio: ProjectAsset[]
}

/**
 * Group a project's images, videos and audio, with the images of video generations apart; assets of other media types are left
 * out.
 * @param current - the project's current state.
 * @returns the groups.
 */
export function assetLibrary(current: WireState): AssetLibrary {
  const assets = [...current.assets].sort((a, b) => b.created_at.localeCompare(a.created_at))
  const ofType = (type: string): ProjectAsset[] => assets.filter(asset => mediaTypeOf(asset.mime) === type)
  const images = ofType('image')
  const videos = ofType('video')
  const audio = ofType('audio')
  const videoProducers = new Set(videos.map(video => video.created_by))
  const rendered = (asset: ProjectAsset): boolean => asset.created_by !== null && videoProducers.has(asset.created_by)
  return { images: images.filter(asset => !rendered(asset)), videos, extracted: images.filter(rendered), audio }
}
