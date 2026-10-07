/* Metro bundles imported images as numeric asset ids. (The browser preview gets Vite's URL strings.) */
declare module '*.png' {
  const asset: number;
  export default asset;
}
