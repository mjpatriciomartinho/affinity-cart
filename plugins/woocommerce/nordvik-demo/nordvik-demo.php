<?php
/**
 * Plugin Name:       Nordvik demo data
 * Description:       Seeds the Nordvik demo store (products, customers, orders) for trying Affinity Cart. Not for production sites.
 * Version:           0.1.0
 * Requires Plugins:  woocommerce
 * License:           AGPL-3.0-only
 */

defined( 'ABSPATH' ) || exit;

/** Seeds once; safe to call repeatedly. Used by the Playground blueprints. */
function nordvik_demo_seed(): void {
	require __DIR__ . '/seed/seed.php';
}

/**
 * The shop's own banner on the home/shop page. Part of the demo store, not of
 * Affinity Cart: it only exists so the demo looks like a real shop.
 */
add_filter(
	'render_block_woocommerce/product-collection',
	static function ( string $html ): string {
		static $done = false;
		if ( $done || ! ( is_shop() || is_front_page() ) ) {
			return $html;
		}
		$done = true;
		$hero = '<section class="nordvik-hero"><div><h1>Gear for the trail, records for the cabin.</h1>'
			. '<p>Urban outdoor and slow culture from Madrid: packs, boots and coffee kit next to vinyl, books and the games worth staying in for.</p></div></section>';
		return $hero . $html;
	}
);

add_action(
	'wp_head',
	static function (): void {
		if ( ! ( is_shop() || is_front_page() ) ) {
			return;
		}
		echo '<style>
.nordvik-hero{position:relative;margin:0 0 2.5rem;padding:clamp(2.5rem,6vw,5rem) clamp(1.25rem,4vw,3rem);background:#1E3A2F;color:#F5F6F2;border-radius:2px}
.nordvik-hero::before{content:"";position:absolute;left:clamp(1.25rem,4vw,3rem);top:0;width:3.5rem;height:.55rem;background:#F2C230}
.nordvik-hero h1{margin:0 0 1rem;font-size:clamp(2rem,4.6vw,3.6rem);line-height:1.02;letter-spacing:-.03em;max-width:16ch;color:inherit}
.nordvik-hero p{margin:0;max-width:52ch;font-size:1.1rem;color:#C8D2B4}
</style>';
	}
);

// WordPress Playground runs on SQLite, where WooCommerce's checkout stock
// reservation fails and reports "not enough units" for any managed-stock item.
// The demo doesn't need reservations, so switch them off here (demo plugin only).
add_filter( 'woocommerce_hold_stock_for_checkout', '__return_false' );
