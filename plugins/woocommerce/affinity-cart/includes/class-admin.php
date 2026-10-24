<?php
namespace AffinityCart;

defined( 'ABSPATH' ) || exit;

/** The wp-admin screen. The UI itself is a small React app in assets/admin. */
class Admin {
	public static function init(): void {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'assets' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( AFFINITY_CART_FILE ), array( __CLASS__, 'links' ) );
	}

	public static function menu(): void {
		$icon = 'data:image/svg+xml;base64,' . base64_encode( '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path fill="black" d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm-3 5a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm-6.5 6h7a3.5 3.5 0 0 1-7 0Z"/></svg>' );
		add_menu_page( __( 'Affinity Cart', 'affinity-cart' ), __( 'Affinity Cart', 'affinity-cart' ), 'manage_woocommerce', 'affinity-cart', array( __CLASS__, 'render' ), $icon, 56 );
	}

	public static function links( array $links ): array {
		array_unshift( $links, '<a href="' . esc_url( admin_url( 'admin.php?page=affinity-cart' ) ) . '">' . esc_html__( 'Open', 'affinity-cart' ) . '</a>' );
		return $links;
	}

	public static function render(): void {
		echo '<div class="wrap"><div id="affinity-cart-admin"></div></div>';
	}

	public static function assets( string $hook ): void {
		if ( 'toplevel_page_affinity-cart' !== $hook ) {
			return;
		}
		$dir = AFFINITY_CART_DIR . 'assets/admin/';
		if ( ! file_exists( $dir . 'admin.js' ) ) {
			return;
		}
		wp_enqueue_style( 'affinity-cart-admin', plugins_url( 'assets/admin/admin.css', AFFINITY_CART_FILE ), array(), filemtime( $dir . 'admin.css' ) );
		wp_enqueue_script( 'affinity-cart-admin', plugins_url( 'assets/admin/admin.js', AFFINITY_CART_FILE ), array(), filemtime( $dir . 'admin.js' ), true );
		wp_localize_script(
			'affinity-cart-admin',
			'AffinityCartAdmin',
			array(
				'rest'     => esc_url_raw( rest_url( Rest::NS ) ),
				'nonce'    => wp_create_nonce( 'wp_rest' ),
				'shopUrl'  => get_permalink( wc_get_page_id( 'shop' ) ),
				'currency' => get_woocommerce_currency_symbol(),
				'apiUrl'   => Client::api_url(),
			)
		);
	}
}
