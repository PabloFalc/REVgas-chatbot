import { z } from 'zod';
import { clone } from './clone';

export const RevgasPaginationSchema = z.object({
  page: z.number(),
  count: z.number(),
  total_count: z.number(),
  page_size: z.number().optional(),
  has_next: z.boolean().optional(),
});
export type RevgasPagination = z.infer<typeof RevgasPaginationSchema>;

export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({ data: z.array(item), pagination: RevgasPaginationSchema });

export type Page<T> = { data: T[]; pagination: RevgasPagination };
export type PageQuery = { page?: number; page_size?: number };

export const PAGE_SIZE = 100;

export function paginate<T>(items: T[], query: PageQuery = {}): Page<T> {
  const page = query.page ?? 1;
  const pageSize = query.page_size ?? PAGE_SIZE;
  const data = items.slice((page - 1) * pageSize, page * pageSize);
  return {
    data: clone(data),
    pagination: {
      page,
      count: data.length,
      total_count: items.length,
      page_size: pageSize,
      has_next: page * pageSize < items.length,
    },
  };
}
