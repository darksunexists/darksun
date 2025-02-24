export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      accounts: {
        Row: {
          avatarUrl: string | null
          createdAt: string | null
          details: Json | null
          email: string
          id: string
          name: string | null
          username: string | null
        }
        Insert: {
          avatarUrl?: string | null
          createdAt?: string | null
          details?: Json | null
          email: string
          id: string
          name?: string | null
          username?: string | null
        }
        Update: {
          avatarUrl?: string | null
          createdAt?: string | null
          details?: Json | null
          email?: string
          id?: string
          name?: string | null
          username?: string | null
        }
        Relationships: []
      }
      article_relations: {
        Row: {
          created_at: string | null
          id: number
          related_article_id: number
          relation_type: Database["public"]["Enums"]["relation_type"]
          source_article_id: number
        }
        Insert: {
          created_at?: string | null
          id?: never
          related_article_id: number
          relation_type: Database["public"]["Enums"]["relation_type"]
          source_article_id: number
        }
        Update: {
          created_at?: string | null
          id?: never
          related_article_id?: number
          relation_type?: Database["public"]["Enums"]["relation_type"]
          source_article_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "fk_related_article"
            columns: ["related_article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_source_article"
            columns: ["source_article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
        ]
      }
      article_sources: {
        Row: {
          added_at: string | null
          article_id: number
          backroom_id: string
          id: number
        }
        Insert: {
          added_at?: string | null
          article_id: number
          backroom_id: string
          id?: never
        }
        Update: {
          added_at?: string | null
          article_id?: number
          backroom_id?: string
          id?: never
        }
        Relationships: [
          {
            foreignKeyName: "fk_article_source"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_backroom"
            columns: ["backroom_id"]
            isOneToOne: false
            referencedRelation: "backrooms"
            referencedColumns: ["id"]
          },
        ]
      }
      article_versions: {
        Row: {
          article: string
          article_id: number
          child_article_id: number | null
          created_at: string | null
          id: number
          iq_tx_hash: string | null
          title: string
          update_reason: string | null
          updated_by: string | null
          version: number
        }
        Insert: {
          article: string
          article_id: number
          child_article_id?: number | null
          created_at?: string | null
          id?: never
          iq_tx_hash?: string | null
          title: string
          update_reason?: string | null
          updated_by?: string | null
          version: number
        }
        Update: {
          article?: string
          article_id?: number
          child_article_id?: number | null
          created_at?: string | null
          id?: never
          iq_tx_hash?: string | null
          title?: string
          update_reason?: string | null
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "article_versions_child_article_id_fkey"
            columns: ["child_article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_article"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
        ]
      }
      articles: {
        Row: {
          article: string
          created_at: string | null
          current_version: number
          id: number
          image_url: string | null
          iq_tx_hash: string | null
          room_id: string
          short_url: string | null
          title: string
          topic: string
          updated_at: string
        }
        Insert: {
          article: string
          created_at?: string | null
          current_version?: number
          id?: never
          image_url?: string | null
          iq_tx_hash?: string | null
          room_id?: string
          short_url?: string | null
          title: string
          topic: string
          updated_at?: string
        }
        Update: {
          article?: string
          created_at?: string | null
          current_version?: number
          id?: never
          image_url?: string | null
          iq_tx_hash?: string | null
          room_id?: string
          short_url?: string | null
          title?: string
          topic?: string
          updated_at?: string
        }
        Relationships: []
      }
      backroom_articles: {
        Row: {
          article_id: number | null
          backroom_id: string | null
          id: number
        }
        Insert: {
          article_id?: number | null
          backroom_id?: string | null
          id?: number
        }
        Update: {
          article_id?: number | null
          backroom_id?: string | null
          id?: number
        }
        Relationships: [
          {
            foreignKeyName: "backroom_articles_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "backroom_articles_backroom_id_fkey"
            columns: ["backroom_id"]
            isOneToOne: false
            referencedRelation: "backrooms"
            referencedColumns: ["id"]
          },
        ]
      }
      backroom_relations: {
        Row: {
          created_at: string | null
          id: number
          related_backroom_id: string
          similarity_score: number
          source_backroom_id: string
        }
        Insert: {
          created_at?: string | null
          id?: number
          related_backroom_id: string
          similarity_score: number
          source_backroom_id: string
        }
        Update: {
          created_at?: string | null
          id?: number
          related_backroom_id?: string
          similarity_score?: number
          source_backroom_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "backroom_relations_related_backroom_id_fkey"
            columns: ["related_backroom_id"]
            isOneToOne: false
            referencedRelation: "backrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "backroom_relations_source_backroom_id_fkey"
            columns: ["source_backroom_id"]
            isOneToOne: false
            referencedRelation: "backrooms"
            referencedColumns: ["id"]
          },
        ]
      }
      backrooms: {
        Row: {
          citations: string[] | null
          claims: string[] | null
          content: Json
          created_at: string
          entities: string[] | null
          id: string
          iq_tx_hash: string | null
          question: string | null
          technical_terms: string[] | null
          title: string
          topic: string | null
          tweet_url: string | null
          upvotes: number
        }
        Insert: {
          citations?: string[] | null
          claims?: string[] | null
          content: Json
          created_at?: string
          entities?: string[] | null
          id?: string
          iq_tx_hash?: string | null
          question?: string | null
          technical_terms?: string[] | null
          title: string
          topic?: string | null
          tweet_url?: string | null
          upvotes?: number
        }
        Update: {
          citations?: string[] | null
          claims?: string[] | null
          content?: Json
          created_at?: string
          entities?: string[] | null
          id?: string
          iq_tx_hash?: string | null
          question?: string | null
          technical_terms?: string[] | null
          title?: string
          topic?: string | null
          tweet_url?: string | null
          upvotes?: number
        }
        Relationships: []
      }
      cache: {
        Row: {
          agentId: string
          createdAt: string | null
          expiresAt: string | null
          key: string
          value: Json | null
        }
        Insert: {
          agentId: string
          createdAt?: string | null
          expiresAt?: string | null
          key: string
          value?: Json | null
        }
        Update: {
          agentId?: string
          createdAt?: string | null
          expiresAt?: string | null
          key?: string
          value?: Json | null
        }
        Relationships: []
      }
      cluster_backrooms: {
        Row: {
          added_at: string | null
          backroom_id: string
          cluster_id: string
        }
        Insert: {
          added_at?: string | null
          backroom_id: string
          cluster_id: string
        }
        Update: {
          added_at?: string | null
          backroom_id?: string
          cluster_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cluster_backrooms_backroom_id_fkey"
            columns: ["backroom_id"]
            isOneToOne: false
            referencedRelation: "backrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cluster_backrooms_cluster_id_fkey"
            columns: ["cluster_id"]
            isOneToOne: false
            referencedRelation: "clusters"
            referencedColumns: ["id"]
          },
        ]
      }
      clusters: {
        Row: {
          article_id: number | null
          created_at: string | null
          id: string
          topic: string
          updated_at: string | null
        }
        Insert: {
          article_id?: number | null
          created_at?: string | null
          id?: string
          topic: string
          updated_at?: string | null
        }
        Update: {
          article_id?: number | null
          created_at?: string | null
          id?: string
          topic?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clusters_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
        ]
      }
      firecrawl_articles: {
        Row: {
          content: string
          created_at: string | null
          description: string | null
          id: string
          title: string
          url: string
        }
        Insert: {
          content: string
          created_at?: string | null
          description?: string | null
          id?: string
          title: string
          url: string
        }
        Update: {
          content?: string
          created_at?: string | null
          description?: string | null
          id?: string
          title?: string
          url?: string
        }
        Relationships: []
      }
      generated_videos: {
        Row: {
          id: number
          videourl: string
        }
        Insert: {
          id?: never
          videourl: string
        }
        Update: {
          id?: never
          videourl?: string
        }
        Relationships: []
      }
      goals: {
        Row: {
          createdAt: string | null
          description: string | null
          id: string
          name: string | null
          objectives: Json
          roomId: string | null
          status: string | null
          userId: string | null
        }
        Insert: {
          createdAt?: string | null
          description?: string | null
          id: string
          name?: string | null
          objectives?: Json
          roomId?: string | null
          status?: string | null
          userId?: string | null
        }
        Update: {
          createdAt?: string | null
          description?: string | null
          id?: string
          name?: string | null
          objectives?: Json
          roomId?: string | null
          status?: string | null
          userId?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_room"
            columns: ["roomId"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_user"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_roomId_fkey"
            columns: ["roomId"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      investigations: {
        Row: {
          backroom_id: string
          conversation_id: string
          created_at: string | null
          firecrawl_articles_id: string | null
          id: string
          in_reply_to: string | null
          responded_to_tweet_url: string | null
          sources: string[] | null
          tweet_response: string | null
          tweet_url: string | null
          twitter_user: string | null
        }
        Insert: {
          backroom_id: string
          conversation_id: string
          created_at?: string | null
          firecrawl_articles_id?: string | null
          id?: string
          in_reply_to?: string | null
          responded_to_tweet_url?: string | null
          sources?: string[] | null
          tweet_response?: string | null
          tweet_url?: string | null
          twitter_user?: string | null
        }
        Update: {
          backroom_id?: string
          conversation_id?: string
          created_at?: string | null
          firecrawl_articles_id?: string | null
          id?: string
          in_reply_to?: string | null
          responded_to_tweet_url?: string | null
          sources?: string[] | null
          tweet_response?: string | null
          tweet_url?: string | null
          twitter_user?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_backroom"
            columns: ["backroom_id"]
            isOneToOne: false
            referencedRelation: "backrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investigations_backroom_id_fkey"
            columns: ["backroom_id"]
            isOneToOne: false
            referencedRelation: "backrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investigations_firecrawl_articles_id_fkey"
            columns: ["firecrawl_articles_id"]
            isOneToOne: false
            referencedRelation: "firecrawl_articles"
            referencedColumns: ["id"]
          },
        ]
      }
      logs: {
        Row: {
          body: Json
          createdAt: string | null
          id: string
          roomId: string
          type: string
          userId: string
        }
        Insert: {
          body: Json
          createdAt?: string | null
          id?: string
          roomId: string
          type: string
          userId: string
        }
        Update: {
          body?: Json
          createdAt?: string | null
          id?: string
          roomId?: string
          type?: string
          userId?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_room"
            columns: ["roomId"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_user"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logs_roomId_fkey"
            columns: ["roomId"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logs_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      logs_duplicate: {
        Row: {
          body: Json
          createdAt: string | null
          id: string
          roomId: string
          type: string
          userId: string
        }
        Insert: {
          body: Json
          createdAt?: string | null
          id?: string
          roomId: string
          type: string
          userId: string
        }
        Update: {
          body?: Json
          createdAt?: string | null
          id?: string
          roomId?: string
          type?: string
          userId?: string
        }
        Relationships: []
      }
      memories: {
        Row: {
          agentId: string | null
          content: Json
          createdAt: string | null
          embedding: string | null
          id: string
          roomId: string | null
          type: string
          unique: boolean
          userId: string | null
        }
        Insert: {
          agentId?: string | null
          content: Json
          createdAt?: string | null
          embedding?: string | null
          id: string
          roomId?: string | null
          type: string
          unique?: boolean
          userId?: string | null
        }
        Update: {
          agentId?: string | null
          content?: Json
          createdAt?: string | null
          embedding?: string | null
          id?: string
          roomId?: string | null
          type?: string
          unique?: boolean
          userId?: string | null
        }
        Relationships: []
      }
      memories_1024: {
        Row: {
          agentId: string | null
          content: Json
          createdAt: string | null
          id: string
          roomId: string | null
          type: string
          unique: boolean
          userId: string | null
        }
        Insert: {
          agentId?: string | null
          content: Json
          createdAt?: string | null
          id: string
          roomId?: string | null
          type: string
          unique?: boolean
          userId?: string | null
        }
        Update: {
          agentId?: string | null
          content?: Json
          createdAt?: string | null
          id?: string
          roomId?: string | null
          type?: string
          unique?: boolean
          userId?: string | null
        }
        Relationships: []
      }
      memories_1536: {
        Row: {
          agentId: string | null
          content: Json
          createdAt: string | null
          id: string
          roomId: string | null
          type: string
          unique: boolean
          userId: string | null
        }
        Insert: {
          agentId?: string | null
          content: Json
          createdAt?: string | null
          id: string
          roomId?: string | null
          type: string
          unique?: boolean
          userId?: string | null
        }
        Update: {
          agentId?: string | null
          content?: Json
          createdAt?: string | null
          id?: string
          roomId?: string | null
          type?: string
          unique?: boolean
          userId?: string | null
        }
        Relationships: []
      }
      memories_384: {
        Row: {
          agentId: string | null
          content: Json
          createdAt: string | null
          id: string
          roomId: string | null
          type: string
          unique: boolean
          userId: string | null
        }
        Insert: {
          agentId?: string | null
          content: Json
          createdAt?: string | null
          id: string
          roomId?: string | null
          type: string
          unique?: boolean
          userId?: string | null
        }
        Update: {
          agentId?: string | null
          content?: Json
          createdAt?: string | null
          id?: string
          roomId?: string | null
          type?: string
          unique?: boolean
          userId?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string | null
          id: number
          last_question: string | null
          messages: Json
        }
        Insert: {
          created_at?: string | null
          id?: never
          last_question?: string | null
          messages: Json
        }
        Update: {
          created_at?: string | null
          id?: never
          last_question?: string | null
          messages?: Json
        }
        Relationships: []
      }
      participants: {
        Row: {
          createdAt: string | null
          id: string
          last_message_read: string | null
          roomId: string | null
          userId: string | null
          userState: string | null
        }
        Insert: {
          createdAt?: string | null
          id: string
          last_message_read?: string | null
          roomId?: string | null
          userId?: string | null
          userState?: string | null
        }
        Update: {
          createdAt?: string | null
          id?: string
          last_message_read?: string | null
          roomId?: string | null
          userId?: string | null
          userState?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_room"
            columns: ["roomId"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_user"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "participants_roomId_fkey"
            columns: ["roomId"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "participants_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      relationships: {
        Row: {
          createdAt: string | null
          id: string
          status: string | null
          userA: string
          userB: string
          userId: string
        }
        Insert: {
          createdAt?: string | null
          id: string
          status?: string | null
          userA: string
          userB: string
          userId: string
        }
        Update: {
          createdAt?: string | null
          id?: string
          status?: string | null
          userA?: string
          userB?: string
          userId?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_user"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_user_a"
            columns: ["userA"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_user_b"
            columns: ["userB"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "relationships_userA_fkey"
            columns: ["userA"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "relationships_userB_fkey"
            columns: ["userB"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "relationships_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          createdAt: string | null
          id: string
        }
        Insert: {
          createdAt?: string | null
          id: string
        }
        Update: {
          createdAt?: string | null
          id?: string
        }
        Relationships: []
      }
      token_burns: {
        Row: {
          amount: number
          burn_address: string
          created_at: string | null
          id: number
          timestamp: string | null
          tx_hash: string
          updated_at: string | null
        }
        Insert: {
          amount: number
          burn_address: string
          created_at?: string | null
          id?: number
          timestamp?: string | null
          tx_hash: string
          updated_at?: string | null
        }
        Update: {
          amount?: number
          burn_address?: string
          created_at?: string | null
          id?: number
          timestamp?: string | null
          tx_hash?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      unclusterable_backrooms: {
        Row: {
          backroom_id: string
          marked_at: string | null
          reason: string
          topic: string
        }
        Insert: {
          backroom_id: string
          marked_at?: string | null
          reason: string
          topic: string
        }
        Update: {
          backroom_id?: string
          marked_at?: string | null
          reason?: string
          topic?: string
        }
        Relationships: [
          {
            foreignKeyName: "unclusterable_backrooms_backroom_id_fkey"
            columns: ["backroom_id"]
            isOneToOne: true
            referencedRelation: "backrooms"
            referencedColumns: ["id"]
          },
        ]
      }
      user_upvotes: {
        Row: {
          backroom_id: string
          created_at: string
          id: number
          user_wallet: string
        }
        Insert: {
          backroom_id: string
          created_at?: string
          id?: number
          user_wallet: string
        }
        Update: {
          backroom_id?: string
          created_at?: string
          id?: number
          user_wallet?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_upvotes_backroom_id_fkey"
            columns: ["backroom_id"]
            isOneToOne: false
            referencedRelation: "backrooms"
            referencedColumns: ["id"]
          },
        ]
      }
      user_videos: {
        Row: {
          article_id: number | null
          based: number
          created_at: string
          id: number
          schizo: number
          status: string
          title: string
          updated_at: string
          video_service_id: string | null
          video_url: string | null
          wallet_address: string
        }
        Insert: {
          article_id?: number | null
          based?: number
          created_at?: string
          id?: never
          schizo?: number
          status: string
          title: string
          updated_at?: string
          video_service_id?: string | null
          video_url?: string | null
          wallet_address: string
        }
        Update: {
          article_id?: number | null
          based?: number
          created_at?: string
          id?: never
          schizo?: number
          status?: string
          title?: string
          updated_at?: string
          video_service_id?: string | null
          video_url?: string | null
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_article"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      dmetaphone: {
        Args: {
          "": string
        }
        Returns: string
      }
      dmetaphone_alt: {
        Args: {
          "": string
        }
        Returns: string
      }
      get_embedding_dimension: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      soundex: {
        Args: {
          "": string
        }
        Returns: string
      }
      text_soundex: {
        Args: {
          "": string
        }
        Returns: string
      }
    }
    Enums: {
      relation_type:
        | "reference"
        | "update"
        | "continuation"
        | "unrelated"
        | "error"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
        PublicSchema["Views"])
    ? (PublicSchema["Tables"] &
        PublicSchema["Views"])[PublicTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  PublicEnumNameOrOptions extends
    | keyof PublicSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : PublicEnumNameOrOptions extends keyof PublicSchema["Enums"]
    ? PublicSchema["Enums"][PublicEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof PublicSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof PublicSchema["CompositeTypes"]
    ? PublicSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never
