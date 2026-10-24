<?php
namespace AffinityCart;

defined( 'ABSPATH' ) || exit;

/**
 * Builds the snapshot sent to the service. Customers are pseudonymised here:
 * names, emails and street addresses never leave the store, only a salted id,
 * city and country.
 */
class Sync {
	public static function snapshot(): array {
		return array(
			'store'     => array(
				'id'       => wp_parse_url( home_url(), PHP_URL_HOST ),
				'name'     => get_bloginfo( 'name' ),
				'url'      => home_url(),
				'currency' => get_woocommerce_currency(),
				'city'     => get_option( 'woocommerce_store_city', '' ),
				'country'  => WC()->countries->get_base_country(),
			),
			'syncedAt'  => gmdate( 'c' ),
			'products'  => self::products(),
			'customers' => self::customers(),
			'orders'    => self::orders(),
		);
	}

	private static function products(): array {
		$out = array();
		foreach ( wc_get_products( array( 'status' => 'publish', 'limit' => -1 ) ) as $p ) {
			// Kits are our own output, not catalog: don't analyse them.
			if ( $p->get_meta( '_affinity_kit_id' ) ) {
				continue;
			}
			$brands = taxonomy_exists( 'product_brand' ) ? wp_get_post_terms( $p->get_id(), 'product_brand', array( 'fields' => 'names' ) ) : array();
			$out[]  = array(
				'id'          => (string) $p->get_id(),
				'sku'         => $p->get_sku(),
				'name'        => html_entity_decode( $p->get_name(), ENT_QUOTES ),
				'brand'       => is_array( $brands ) && $brands ? $brands[0] : '',
				'categories'  => wp_get_post_terms( $p->get_id(), 'product_cat', array( 'fields' => 'names' ) ),
				'price'       => (float) $p->get_price(),
				'stock'       => $p->managing_stock() ? (int) $p->get_stock_quantity() : null,
				'description' => wp_strip_all_tags( $p->get_short_description() ?: $p->get_description() ),
				'url'         => get_permalink( $p->get_id() ),
				'image'       => $p->get_image_id() ? wp_get_attachment_url( $p->get_image_id() ) : null,
			);
		}
		return $out;
	}

	/**
	 * A stable, salted id per customer. The salt is the plugin's own (not WordPress's
	 * auth salt) so ids survive salt rotation, and a demo can pin it.
	 */
	public static function pseudonym( $customer_id ): string {
		$salt = get_option( 'affinity_cart_salt' );
		if ( ! $salt ) {
			$salt = wp_generate_password( 32, true, true );
			update_option( 'affinity_cart_salt', $salt, false );
		}
		return substr( hash_hmac( 'sha256', (string) $customer_id, $salt ), 0, 12 );
	}

	private static function customers(): array {
		$out = array();
		foreach ( get_users( array( 'role' => 'customer', 'fields' => 'ID' ) ) as $id ) {
			$c     = new \WC_Customer( $id );
			$out[] = array(
				'id'      => self::pseudonym( $id ),
				'city'    => $c->get_billing_city(),
				'country' => $c->get_billing_country(),
			);
		}
		return $out;
	}

	private static function orders(): array {
		$out = array();
		// wc_get_orders works with both HPOS and legacy post storage.
		$orders = wc_get_orders(
			array(
				'limit'        => -1,
				'status'       => array( 'wc-completed', 'wc-processing' ),
				'date_created' => '>' . ( time() - YEAR_IN_SECONDS ),
			)
		);
		foreach ( $orders as $o ) {
			$out[] = self::order( $o );
		}
		return $out;
	}

	public static function order( \WC_Order $o ): array {
		$items = array();
		foreach ( $o->get_items() as $item ) {
			$items[] = array_filter(
				array(
					'productId' => (string) $item->get_product_id(),
					'qty'       => (int) $item->get_quantity(),
					'total'     => (float) $item->get_total(),
					'source'    => $item->get_meta( '_affinity_source' ) ?: null,
				),
				static fn( $v ) => null !== $v
			);
		}
		$discount = 0.0;
		foreach ( $o->get_fees() as $fee ) {
			if ( (float) $fee->get_total() < 0 && 0 === strpos( $fee->get_name(), 'Kit:' ) ) {
				$discount -= (float) $fee->get_total();
			}
		}
		return array(
			'discount' => $discount,
			'id'       => (string) $o->get_id(),
			'customer' => $o->get_customer_id() ? self::pseudonym( $o->get_customer_id() ) : null,
			'date'     => $o->get_date_created() ? $o->get_date_created()->date( 'c' ) : gmdate( 'c' ),
			'city'     => $o->get_billing_city(),
			'country'  => $o->get_billing_country(),
			'total'    => (float) $o->get_total(),
			'items'    => $items,
		);
	}
}
