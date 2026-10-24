<?php
/**
 * Plugin Name:       Affinity Cart for WooCommerce
 * Description:       Cultural cross-selling powered by the Qloo taste graph: reads your catalog and customers, finds what your buyers love, and recommends it.
 * Version:           0.1.0
 * Requires at least: 6.5
 * Requires PHP:      8.1
 * Requires Plugins:  woocommerce
 * Author:            Affinity Cart
 * License:           AGPL-3.0-only
 * Text Domain:       affinity-cart
 */

defined( 'ABSPATH' ) || exit;

define( 'AFFINITY_CART_VERSION', '0.1.0' );
define( 'AFFINITY_CART_FILE', __FILE__ );
define( 'AFFINITY_CART_DIR', plugin_dir_path( __FILE__ ) );

add_action(
	'before_woocommerce_init',
	static function () {
		if ( class_exists( \Automattic\WooCommerce\Utilities\FeaturesUtil::class ) ) {
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', __FILE__, true );
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'cart_checkout_blocks', __FILE__, true );
		}
	}
);

require_once AFFINITY_CART_DIR . 'includes/class-client.php';
require_once AFFINITY_CART_DIR . 'includes/class-sync.php';
require_once AFFINITY_CART_DIR . 'includes/class-rest.php';
require_once AFFINITY_CART_DIR . 'includes/class-admin.php';
require_once AFFINITY_CART_DIR . 'includes/class-storefront.php';
require_once AFFINITY_CART_DIR . 'includes/class-actions.php';
require_once AFFINITY_CART_DIR . 'includes/class-autopilot.php';

register_activation_hook(
	__FILE__,
	static function () {
		// Each store gets its own key on first activation; the SaaS derives the store id from it.
		if ( ! get_option( 'affinity_cart_key' ) ) {
			update_option( 'affinity_cart_key', 'ac_' . wp_generate_password( 32, false ) );
		}
	}
);

add_action(
	'plugins_loaded',
	static function () {
		if ( ! class_exists( 'WooCommerce' ) ) {
			return;
		}
		AffinityCart\Rest::init();
		AffinityCart\Admin::init();
		AffinityCart\Storefront::init();
		AffinityCart\Autopilot::init();
	}
);
