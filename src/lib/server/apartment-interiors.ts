import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

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

export function getDefaultApartmentInteriorsPath() {
	return join(process.cwd(), 'src/lib/server/data/apartment-interiors.json');
}

export function loadApartmentInteriorManifest(
	filePath = getDefaultApartmentInteriorsPath()
): RepresentativeInteriorManifest {
	try {
		const raw = readFileSync(filePath, 'utf-8');
		return representativeInteriorManifestSchema.parse(JSON.parse(raw));
	} catch {
		return {
			downloadedAt: new Date(0).toISOString(),
			total: 0,
			photos: []
		};
	}
}

export function loadApartmentInteriorPhotos(filePath?: string): RepresentativeInteriorPhoto[] {
	return loadApartmentInteriorManifest(filePath).photos;
}
