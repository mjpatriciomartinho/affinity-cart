<?php
namespace AffinityCart;

defined( 'ABSPATH' ) || exit;

/**
 * Storefront: the "Complete the vibe" widget on product pages and in the cart,
 * and attribution: items added from the widget carry their source through to
 * the order line, which is what revenue attribution counts.
 */
class Storefront {
	const SOURCES      = array( 'vibe', 'kit', 'live', 'gift' );
	const KIT_DISCOUNT = 0.1;
	private static bool $rendered = false;

	public static function init(): void {
		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'assets' ) );
		add_action( 'woocommerce_after_single_product_summary', array( __CLASS__, 'product_widget' ), 15 );
		// Block themes render the product page with blocks; append after the details block.
		add_filter( 'render_block_woocommerce/product-details', array( __CLASS__, 'append_product_widget' ) );
		add_filter( 'render_block_woocommerce/cart', array( __CLASS__, 'append_cart_widget' ) );
		// Before the shop grid; priority 5 so a theme or demo banner can still sit above it.
		add_filter( 'render_block_woocommerce/product-collection', array( __CLASS__, 'prepend_shop_widget' ), 5 );
		add_action( 'woocommerce_before_shop_loop', array( __CLASS__, 'shop_widget' ), 5 );
		add_action( 'woocommerce_cart_calculate_fees', array( __CLASS__, 'kit_discount' ) );
		add_action( 'woocommerce_after_cart_table', array( __CLASS__, 'cart_widget' ) );
		add_action( 'init', array( __CLASS__, 'preview_city' ) );

		add_filter( 'woocommerce_add_cart_item_data', array( __CLASS__, 'tag_cart_item' ), 10, 2 );
		add_action( 'woocommerce_checkout_create_order_line_item', array( __CLASS__, 'tag_order_item' ), 10, 3 );
		add_action( 'woocommerce_order_status_processing', array( __CLASS__, 'report_order' ) );
		add_action( 'woocommerce_order_status_completed', array( __CLASS__, 'report_order' ) );
	}

	public static function gift_finder_enabled(): bool {
		return 'no' !== get_option( 'affinity_cart_gift_finder', 'yes' );
	}

	public static function assets(): void {
		// The gift finder floats on every storefront page; the rest only where it renders.
		if ( is_admin() || ! ( self::gift_finder_enabled() || is_product() || is_cart() || is_shop() || is_product_category() ) ) {
			return;
		}
		wp_enqueue_style( 'affinity-cart', plugins_url( 'assets/storefront.css', AFFINITY_CART_FILE ), array(), AFFINITY_CART_VERSION );
		wp_enqueue_script( 'affinity-cart', plugins_url( 'assets/storefront.js', AFFINITY_CART_FILE ), array(), AFFINITY_CART_VERSION, array( 'strategy' => 'defer' ) );
		wp_localize_script(
			'affinity-cart',
			'AffinityCart',
			array(
				'rest'       => esc_url_raw( rest_url( Rest::NS ) ),
				'nonce'      => wp_create_nonce( 'wp_rest' ),
				'productId'  => is_product() ? get_queried_object_id() : null,
				'cartUrl'    => wc_get_cart_url(),
				'currency'   => get_woocommerce_currency_symbol(),
				'giftFinder' => self::gift_finder_enabled(),
			)
		);
	}

	private static function container( string $context, int $product_id = 0 ): string {
		self::$rendered = true;
		return sprintf(
			'<section class="affinity-cart" data-context="%s" data-product="%d" aria-live="polite"></section>',
			esc_attr( $context ),
			$product_id
		);
	}

	public static function product_widget(): void {
		if ( ! self::$rendered ) {
			echo self::container( 'product', get_the_ID() ); // phpcs:ignore WordPress.Security.EscapeOutput -- escaped in container().
		}
	}

	public static function append_product_widget( string $html ): string {
		return self::$rendered || ! is_product() ? $html : $html . self::container( 'product', get_queried_object_id() );
	}

	private static bool $shop_rendered = false;

	public static function prepend_shop_widget( string $html ): string {
		if ( self::$shop_rendered || ! ( is_shop() || is_product_category() || is_front_page() ) ) {
			return $html;
		}
		self::$shop_rendered = true;
		return self::container( 'shop' ) . $html;
	}

	public static function shop_widget(): void {
		if ( ! self::$shop_rendered ) {
			self::$shop_rendered = true;
			echo self::container( 'shop' ); // phpcs:ignore WordPress.Security.EscapeOutput
		}
	}

	/** Takes the kit discount off when every product of a kit was added as that kit. */
	public static function kit_discount( \WC_Cart $cart ): void {
		$kit_items = array();
		foreach ( $cart->get_cart() as $item ) {
			if ( ( $item['affinity_source'] ?? '' ) === 'kit' ) {
				$kit_items[ (string) $item['product_id'] ] = (float) $item['data']->get_price();
			}
		}
		foreach ( (array) get_option( 'affinity_cart_kits', array() ) as $kit ) {
			$ids = array_map( 'strval', $kit['productIds'] ?? array() );
			if ( $ids && ! array_diff( $ids, array_keys( $kit_items ) ) ) {
				$total = array_sum( array_intersect_key( $kit_items, array_flip( $ids ) ) );
				/* translators: %s: kit name */
				$cart->add_fee( sprintf( __( 'Kit: %s', 'affinity-cart' ), $kit['name'] ?? '' ), -round( $total * self::KIT_DISCOUNT, 2 ) );
			}
		}
	}

	public static function append_cart_widget( string $html ): string {
		return $html . self::container( 'cart' );
	}

	public static function cart_widget(): void {
		echo self::container( 'cart' ); // phpcs:ignore WordPress.Security.EscapeOutput
	}

	/** ?affinity_city=Berlin lets the merchant preview the shop as a visitor from another city. */
	public static function preview_city(): void {
		if ( isset( $_GET['affinity_city'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
			$city = sanitize_text_field( wp_unslash( $_GET['affinity_city'] ) ); // phpcs:ignore WordPress.Security.NonceVerification
			setcookie( 'affinity_city', $city, 0, COOKIEPATH ?: '/' );
			$_COOKIE['affinity_city'] = $city;
		}
		if ( empty( $_COOKIE['affinity_vid'] ) && ! is_admin() ) {
			$vid = wp_generate_password( 10, false );
			setcookie( 'affinity_vid', $vid, time() + DAY_IN_SECONDS, COOKIEPATH ?: '/' );
			$_COOKIE['affinity_vid'] = $vid;
		}
	}

	public static function tag_cart_item( array $data ): array {
		$src = isset( $_REQUEST['affinity_src'] ) ? sanitize_key( wp_unslash( $_REQUEST['affinity_src'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
		// Items added from a published kit's own product page count as that kit.
		$from = isset( $_REQUEST['add-to-cart'] ) ? wc_get_product( absint( $_REQUEST['add-to-cart'] ) ) : null; // phpcs:ignore WordPress.Security.NonceVerification
		if ( ! $src && $from && $from->get_meta( '_affinity_kit_id' ) ) {
			$src = 'kit';
		}
		if ( in_array( $src, self::SOURCES, true ) ) {
			$data['affinity_source'] = $src;
		}
		return $data;
	}

	public static function tag_order_item( $item, $cart_item_key, array $values ): void {
		if ( ! empty( $values['affinity_source'] ) ) {
			$item->add_meta_data( '_affinity_source', $values['affinity_source'], true );
		}
	}

	public static function report_order( $order_id ): void {
		$order = wc_get_order( $order_id );
		if ( $order && ! $order->get_meta( '_affinity_reported' ) ) {
			Client::request( 'POST', '/orders', Sync::order( $order ), 5 );
			$order->update_meta_data( '_affinity_reported', time() );
			$order->save();
		}
	}
}
