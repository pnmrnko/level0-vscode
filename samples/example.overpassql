// Cafes and restaurants in the extent of the active Level0L document.
// Run with "Level0L: Run Overpass query" while this file is active, or select
// a query anywhere and run the command. "out meta" is needed to get object
// versions, without which the objects cannot be uploaded later.
[out:xml][timeout:25];
nwr[amenity~"^(cafe|restaurant)$"]({{bbox}});
out meta;
