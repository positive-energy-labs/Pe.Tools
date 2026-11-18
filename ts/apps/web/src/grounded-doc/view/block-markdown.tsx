export const pageKey = (page: number) => `p${page}`;

export function anchorRef(refs: React.RefObject<Map<string, HTMLElement>>, key: string) {
  return (el: HTMLElement | null) => {
    if (el) refs.current.set(key, el);
    else refs.current.delete(key);
  };
}
