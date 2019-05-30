/**
* The `Matter.Grid` module contains methods for creating and manipulating collision broadphase grid structures.
*
* @class Grid
*/

var Grid = {};

module.exports = Grid;

var Pair = require('./Pair');
var Detector = require('./Detector');
var Common = require('../core/Common');

(function() {

    /**
     * Creates a new grid.
     * @method create
     * @param {} options
     * @return {grid} A new grid
     */
    Grid.create = function(options) {
        var defaults = {
            controller: Grid,
            detector: Detector.collisions,
            buckets: {},
            freeBuckets: [],
            pairs: {},
            pairsList: [],
            bucketWidth: 48,
            bucketHeight: 48,
        };

        var grid = Common.extend(defaults, options);

        grid._union = Grid._createRegion(0, 0, 0, 0);
        grid._current = Grid._createRegion(0, 0, 0, 0);

        return grid;
    };

    /**
     * The width of a single grid bucket.
     *
     * @property bucketWidth
     * @type number
     * @default 48
     */

    /**
     * The height of a single grid bucket.
     *
     * @property bucketHeight
     * @type number
     * @default 48
     */

    /**
     * Updates the grid.
     * @method update
     * @param {grid} grid
     * @param {body[]} bodies
     * @param {engine} engine
     * @param {boolean} forceUpdate
     */
    Grid.update = function(grid, bodies, engine, forceUpdate) {
        var i, col, row,
            world = engine.world,
            buckets = grid.buckets,
            bucket,
            bucketId,
            gridChanged = false;

        // @if DEBUG
        var metrics = engine.metrics;
        metrics.broadphaseTests = 0;
        // @endif

        for (i = 0; i < bodies.length; i++) {
            var body = bodies[i];

            if (body.isSleeping && !forceUpdate)
                continue;

            // don't update out of world bodies
            if (body.bounds.max.x < world.bounds.min.x || body.bounds.min.x > world.bounds.max.x
                || body.bounds.max.y < world.bounds.min.y || body.bounds.min.y > world.bounds.max.y)
                continue;

            // determine current region coordinates for this body
            var newRegion = Grid._getRegion(grid, grid._current, body);

            // if the body has changed grid region
            if (!body.region || !Grid._isSameRegion(body.region, newRegion) || forceUpdate) {

                // @if DEBUG
                metrics.broadphaseTests += 1;
                // @endif

                // determine the union of body's previous and current region
                var union = !body.region || forceUpdate 
                    ? Grid._setRegion(grid._union, newRegion)
                    : Grid._regionUnion(grid._union, newRegion, body.region);

                // Ensure body has a region assigned.
                var createRegion = !body.region;
                if (createRegion) {
                    body.region = Grid._createRegionFrom(newRegion);
                }

                // update grid buckets affected by region change
                // iterate over the union of both regions
                for (col = union.startCol; col <= union.endCol; col++) {
                    for (row = union.startRow; row <= union.endRow; row++) {
                        bucketId = Grid._getBucketId(col, row);
                        bucket = buckets[bucketId];

                        var isInsideNewRegion = (col >= newRegion.startCol && col <= newRegion.endCol
                                                && row >= newRegion.startRow && row <= newRegion.endRow);

                        var isInsideOldRegion = (col >= body.region.startCol && col <= body.region.endCol
                                                && row >= body.region.startRow && row <= body.region.endRow);

                        // remove from old region buckets
                        if (!isInsideNewRegion && isInsideOldRegion) {
                            if (isInsideOldRegion) {
                                if (bucket)
                                    Grid._bucketRemoveBody(grid, bucket, body);
                            }
                        }

                        // add to new region buckets
                        if (createRegion || (isInsideNewRegion && !isInsideOldRegion) || forceUpdate) {
                            if (!bucket)
                                bucket = Grid._createBucket(grid, buckets, bucketId);
                            Grid._bucketAddBody(grid, bucket, body);
                        }
                    }
                }

                // set the new region
                Grid._setRegion(body.region, newRegion);

                // flag changes so we can update pairs
                gridChanged = true;
            }
        }

        // update pairs list only if pairs changed (i.e. a body changed region)
        if (gridChanged)
            Grid._createActivePairsList(grid, grid.pairsList);
    };

    /**
     * Clears the grid.
     * @method clear
     * @param {grid} grid
     */
    Grid.clear = function(grid) {

        // Instead of allocating a new bucket map, wipe the existing one
        // and recycle buckets themselves into the free bucket list.
        // This should reduce allocations and save on GC load.
        // grid.buckets = {};

        var buckets = grid.buckets,
            freeBuckets = grid.freeBuckets;

        for (const key in buckets) {
            let bucket = buckets[key];
            bucket.length = 0;

            freeBuckets.push(bucket);
            delete buckets[key];
        }
        
        grid.pairs = {};
        grid.pairsList.length = 0;
    };

    /**
     * Finds the union of two regions.
     * @method _regionUnion
     * @private
     * @param {} regionA
     * @param {} regionB
     * @return {} region
     */
    Grid._regionUnion = function(union, regionA, regionB) {
        union.startCol = Math.min(regionA.startCol, regionB.startCol),
        union.endCol = Math.max(regionA.endCol, regionB.endCol),
        union.startRow = Math.min(regionA.startRow, regionB.startRow),
        union.endRow = Math.max(regionA.endRow, regionB.endRow);

        return union;
    };

    /**
     * Creates a region.
     * @method _createRegion
     * @private
     * @param {} startCol
     * @param {} endCol
     * @param {} startRow
     * @param {} endRow
     * @return {} region
     */
    Grid._createRegion = function(startCol, endCol, startRow, endRow) {
        return { 
            startCol: startCol, 
            endCol: endCol, 
            startRow: startRow, 
            endRow: endRow 
        };
    };

    /**
     * Sets the given region values.
     * @method _setRegion
     * @private
     * @param {} region
     * @param {} source
     * @return {} region
     */
    Grid._setRegion = function(region, source) {
        region.startCol = source.startCol;
        region.endCol = source.endCol;
        region.startRow = source.startRow; 
        region.endRow = source.endRow;

        return region;
    };

    Grid._createRegionFrom = function(r) {
        return Grid._createRegion(r.startCol, r.endCol, r.startRow, r.endRow);
    }

    /**
     * Sets the given region from body.
     * @method _setRegion
     * @private
     * @param {} region
     * @param {} body
     * @return {} region
     */
    Grid._getRegion = function(grid, region, body) {

        var bounds = body.bounds;

        region.startCol = Math.floor(bounds.min.x / grid.bucketWidth);
        region.endCol = Math.floor(bounds.max.x / grid.bucketWidth);
        region.startRow = Math.floor(bounds.min.y / grid.bucketHeight); 
        region.endRow = Math.floor(bounds.max.y / grid.bucketHeight);

        return region;
    };

    Grid._isSameRegion = function(regionA, regionB) {

        if (!regionA || !regionB)
            return false;

        return regionA.startCol == regionB.startCol 
            && regionA.endCol == regionB.endCol 
            && regionA.startRow == regionB.startRow 
            && regionA.endRow == regionB.endRow;
    };

    /**
     * Gets the bucket id at the given position.
     * @method _getBucketId
     * @private
     * @param {} column
     * @param {} row
     * @return {number} bucket id
     */
    Grid._getBucketId = function(column, row) {
        // Use a number instead of a string to hopefully reduce GC allocations.
        return column * 1000000000 + row;
        // return 'C' + column + 'R' + row;
    };

    /**
     * Creates a bucket.
     * @method _createBucket
     * @private
     * @param {} buckets
     * @param {} bucketId
     * @return {} bucket
     */
    Grid._createBucket = function(grid, buckets, bucketId) {

        var bucket;
        var freeBuckets = grid.freeBuckets;
        if (freeBuckets.length > 0) {
            bucket = freeBuckets.pop();
        }
        else {
            bucket = [];
        }

        buckets[bucketId] = bucket;
        return bucket;
    };

    /**
     * Adds a body to a bucket.
     * @method _bucketAddBody
     * @private
     * @param {} grid
     * @param {} bucket
     * @param {} body
     */
    Grid._bucketAddBody = function(grid, bucket, body) {
        // add new pairs
        for (var i = 0; i < bucket.length; i++) {
            var bodyB = bucket[i];

            if (body.id === bodyB.id || (body.isStatic && bodyB.isStatic))
                continue;

            // keep track of the number of buckets the pair exists in
            // important for Grid.update to work
            var pairId = Pair.id(body, bodyB),
                pair = grid.pairs[pairId];

            if (pair) {
                pair[2] += 1;
            } else {
                grid.pairs[pairId] = [body, bodyB, 1];
            }
        }

        // add to bodies (after pairs, otherwise pairs with self)
        bucket.push(body);
    };

    /**
     * Removes a body from a bucket.
     * @method _bucketRemoveBody
     * @private
     * @param {} grid
     * @param {} bucket
     * @param {} body
     */
    Grid._bucketRemoveBody = function(grid, bucket, body) {

        // remove from bucket
        // bucket.splice(Common.indexOf(bucket, body), 1);
        
        // Instead of using splice (which creates GC load), just move last bucket element to the vacated spot.
        var index = Common.indexOf(bucket, body);
        bucket[index] = bucket[bucket.length - 1];
        bucket.length--;

        // update pair counts
        for (var i = 0; i < bucket.length; i++) {
            // keep track of the number of buckets the pair exists in
            // important for _createActivePairsList to work
            var bodyB = bucket[i],
                pairId = Pair.id(body, bodyB),
                pair = grid.pairs[pairId];

            if (pair)
                pair[2] -= 1;
        }
    };

    /**
     * Generates a list of the active pairs in the grid.
     * @method _createActivePairsList
     * @private
     * @param {} grid
     * @return [] pairs
     */
    Grid._createActivePairsList = function(grid, pairs) {
        var pairKeys,
            pair;

        pairs.length = 0;

        // grid.pairs is used as a hashmap
        pairKeys = Common.keys(grid.pairs);

        // iterate over grid.pairs
        for (var k = 0; k < pairKeys.length; k++) {
            pair = grid.pairs[pairKeys[k]];

            // if pair exists in at least one bucket
            // it is a pair that needs further collision testing so push it
            if (pair[2] > 0) {
                pairs.push(pair);
            } else {
                delete grid.pairs[pairKeys[k]];
            }
        }

        return pairs;
    };
    
})();
