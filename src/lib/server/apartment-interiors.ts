import { z } from 'zod';
import apartmentInteriorsData from '$lib/server/data/apartment-interiors.json';

export const representativeInteriorPhotoSchema = z.object({
	id: z.number().int().nonnegative(),
	roomType: z.string().trim().min(1),
	query: z.string().trim().min(1),
	localPath: z.string().trim().min(1),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
	alt: z.string().trim().min(1),
	photographer: z.string().trim().min(1),
	photographerUrl: z.string().trim().url(),
	pexelsUrl: z.string().trim().url()
});

export const representativeInteriorManifestSchema = z.object({
	downloadedAt: z.string(),
	total: z.number().int().nonnegative(),
	photos: z.array(representativeInteriorPhotoSchema)
});

export type RepresentativeInteriorPhoto = z.infer<typeof representativeInteriorPhotoSchema>;
export type RepresentativeInteriorManifest = z.infer<typeof representativeInteriorManifestSchema>;

export function loadApartmentInteriorManifest(): RepresentativeInteriorManifest {
	try {
		return representativeInteriorManifestSchema.parse(apartmentInteriorsData);
	} catch {
		return {
			downloadedAt: new Date(0).toISOString(),
			total: 0,
			photos: []
		};
	}
}

export function loadApartmentInteriorPhotos(): RepresentativeInteriorPhoto[] {
	return loadApartmentInteriorManifest().photos;
}
